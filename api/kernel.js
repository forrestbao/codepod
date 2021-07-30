// this file is used to create kernel process and act as proxy to communicate
// with the kernels using ZeroMQ

// import { spawn } from "node-pty";
import { spawn } from "child_process";

import zmq from "zeromq";
// const zmq = require("zeromq");
import net from "net";
import { readFile, readFileSync, writeFile, writeFileSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import Docker from "dockerode";

function getFreePort() {
  return new Promise((resolve) => {
    // get one free pod
    var srv = net.createServer();
    srv.listen(0, function () {
      //   console.log("Listening on port " + srv.address().port);
      resolve(srv);
    });
  });
}

async function getAvailablePorts(n) {
  let srvs = [];
  for (let i = 0; i < n; i++) {
    srvs.push(getFreePort());
  }
  //   console.log(srvs);
  srvs = await Promise.all(srvs);
  //   console.log(srvs);
  let ports = srvs.map((srv) => srv.address().port);
  srvs.map((srv) => srv.close());
  //   console.log(ports);
  return ports;
}

// getAvailablePorts(5);

async function test() {
  let srv = getFreePort();
  console.log(srv);
  srv = await Promise.all([srv]);
  console.log(srv[0]);
  console.log(srv[0].address().port);
  srv.map((s) => s.address().port);
}

// test();

export async function createNewConnSpec() {
  // get a list of free ports
  // well, the ports should be generated from the kernel side
  //
  // But, to be compatible with jupyter kernels, I need to do this
  let ports = await getAvailablePorts(5);
  let spec = {
    shell_port: ports[0],
    iopub_port: ports[1],
    stdin_port: ports[2],
    control_port: ports[3],
    hb_port: ports[4],
    ip: "127.0.0.1",
    key: "412d24d7-baca5d46b674d910851edd2f",
    // key: "",
    transport: "tcp",
    signature_scheme: "hmac-sha256",
    kernel_name: "julia-1.6",
  };
  return spec;
}

// writeConnFile();

//   let cmdArgs = {
//     display_name: "Julia 1.6.1",
//     argv: [
//       "/Applications/Julia-1.6.app/Contents/Resources/julia/bin/julia",
//       "-i",
//       "--color=yes",
//       "--project=@.",
//       "/Users/hebi/.julia/packages/IJulia/e8kqU/src/kernel.jl",
//       "{connection_file}",
//     ],
//     language: "julia",
//     env: {},
//     interrupt_mode: "signal",
//   };
async function startJuliaKernel(newSpec = false) {
  // 1. generate connection file
  let connFname = "/Users/hebi/Documents/GitHub/codepod/api/codepod-conn.json";
  let spec;
  if (newSpec) {
    spec = await createNewConnSpec();
    writeFileSync(connFname, JSON.stringify(spec));
  } else {
    spec = JSON.parse(readFileSync(connFname));
  }

  //   let juliaKernelFile =
  //     "/Users/hebi/Library/Jupyter/kernels/julia-1.6/kernel.json";
  let juliaKernelFile = "./kernel.json";
  // 2. cmd args
  let cmdArgs = JSON.parse(readFileSync(juliaKernelFile));
  //   console.log(cmdArgs);
  let argv = cmdArgs.argv
    .map((s) => s.replace("{connection_file}", connFname))
    .filter((x) => x.length > 0);
  console.log(argv);
  console.log(argv.join(" "));
  // spawn the process
  let proc = spawn(argv[0], argv.slice(1));
  proc.stdout.on("data", (data) => {
    console.log(`child stdout:\n${data}`);
  });

  proc.stderr.on("data", (data) => {
    console.error(`child stderr:\n${data}`);
  });
  //   proc.close();
  console.log("kernel process ID:", proc.pid);
  return spec;
}

function serializeMsg(msg, key) {
  // return a list of message parts
  // 4. header
  let part4 = JSON.stringify(msg.header);
  // 5. parent header
  let part5 = JSON.stringify({});
  // 6. meta data
  let part6 = JSON.stringify({});
  // 7. content
  let part7 = JSON.stringify(msg.content);

  return [
    // 1. the id
    msg.header.msg_id,
    // 2. "<IDS|MSG>"
    "<IDS|MSG>",
    // 3. HMAC
    // "",
    crypto
      .createHmac("sha256", key)
      .update(part4)
      .update(part5)
      .update(part6)
      .update(part7)
      .digest("hex"),
    part4,
    part5,
    part6,
    part7,
    // 8. extra raw buffers]
    // I'm not sending this, because iracket crashes on this
    // JSON.stringify({}),
  ];
}

function deserializeMsg(frames, key = null) {
  var i = 0;
  var idents = [];
  for (i = 0; i < frames.length; i++) {
    var frame = frames[i];
    // console.log(i);
    // console.log(toJSON(frame));
    if (frame.toString() === "<IDS|MSG>") {
      break;
    }
    idents.push(frame);
  }
  if (frames.length - i < 5) {
    console.log("MESSAGE: DECODE: Not enough message frames", frames);
    return null;
  }

  if (frames[i].toString() !== "<IDS|MSG>") {
    console.log("MESSAGE: DECODE: Missing delimiter", frames);
    return null;
  }

  if (key) {
    var obtainedSignature = frames[i + 1].toString();

    var hmac = crypto.createHmac("sha256", key);
    hmac.update(frames[i + 2]);
    hmac.update(frames[i + 3]);
    hmac.update(frames[i + 4]);
    hmac.update(frames[i + 5]);
    var expectedSignature = hmac.digest("hex");

    if (expectedSignature !== obtainedSignature) {
      console.log(
        "MESSAGE: DECODE: Incorrect message signature:",
        "Obtained = " + obtainedSignature,
        "Expected = " + expectedSignature
      );
      return null;
    }
  }

  function toJSON(value) {
    return JSON.parse(value.toString());
  }

  var message = {
    idents: idents,
    header: toJSON(frames[i + 2]),
    parent_header: toJSON(frames[i + 3]),
    content: toJSON(frames[i + 5]),
    metadata: toJSON(frames[i + 4]),
    buffers: Array.prototype.slice.apply(frames, [i + 6]),
  };

  return message;
}

export function constructMessage({
  msg_type,
  content = {},
  msg_id = uuidv4(),
}) {
  // TODO I should probably switch to Typescript just to avoid writing such checks
  if (!msg_type) {
    throw new Error("msg_type is undefined");
  }
  return {
    header: {
      msg_id: msg_id,
      msg_type: msg_type,
      session: uuidv4(),
      username: "dummy_user",
      date: new Date().toISOString(),
      version: "5.0",
    },
    parent_header: {},
    metadata: {},
    buffers: [],
    content: content,
  };
}

export function constructExecuteRequest({ code, msg_id, cp = {} }) {
  if (!code || !msg_id) {
    throw new Error("Must provide code and msg_id");
  }
  return constructMessage({
    msg_type: "execute_request",
    msg_id,
    content: {
      // Source code to be executed by the kernel, one or more lines.
      code,
      cp,
      // FIXME if this is true, no result is returned!
      silent: false,
      store_history: false,
      // XXX this does not seem to be used
      user_expressions: {
        x: "3+4",
      },
      allow_stdin: false,
      stop_on_error: true,
    },
  });
}

export class ZmqWire {
  constructor(connFname, ip) {
    this.kernelSpec = JSON.parse(readFileSync(connFname));
    // console.log(this.kernelSpec);
    if (ip) {
      console.log("Got IP Address:", ip);
      // FIXME hard-coded IP and port
      this.kernelSpec.ip = ip;
    }

    // Pub/Sub Router/Dealer
    this.shell = new zmq.Dealer();
    this.shell.connect(
      `tcp://${this.kernelSpec.ip}:${this.kernelSpec.shell_port}`
    );
    // FIXME this is not actually connected. I need to check the real status
    // There does not seem to have any method to check connection status
    console.log("connected to shell port");

    this.kernelStatus = "uknown";
    this.results = {};
  }

  //   getKernelStatus() {
  //     return kernelStatus;
  //   }

  // Send code to kernel. Return the ID of the execute_request
  // The front-end will listen to IOPub and display result accordingly based on
  // this ID.
  sendShellMessage(msg) {
    // bind zeromq socket to the ports
    console.log("sending shell mesasge ..");
    // console.log(msg);
    // FIXME how to receive the message?
    //   sock.on("message", (msg) => {
    //     console.log("sock on:", msg);
    //   });
    // FIXME I probably need to wait until the server is started
    // sock.send(msg);
    this.shell.send(serializeMsg(msg, this.kernelSpec.key));
  }

  async listenIOPub(func) {
    if (this.iopub && !this.iopub.closed) {
      console.log("disconnecting previous iopub ..");
      this.iopub.close();
    }
    this.iopub = new zmq.Subscriber();
    console.log("connecting IOPub");
    this.iopub.connect(
      `tcp://${this.kernelSpec.ip}:${this.kernelSpec.iopub_port}`
    );
    this.iopub.subscribe();
    console.log("waiting for iopub");

    //   let msgs = await pubsock.receive();
    //   console.log(msgs);
    // FIXME this socket can only be listened here once!
    for await (const [topic, ...frames] of this.iopub) {
      //   func(topic, frames);

      let msgs = deserializeMsg(frames, this.kernelSpec.key);
      func(topic.toString(), msgs);
    }
  }
}

async function removeContainer(name) {
  return new Promise((resolve, reject) => {
    var docker = new Docker();
    console.log("remove if already exist");
    let old = docker.getContainer(name);
    old.stop((err, data) => {
      // FIXME If the container is stopped but not removed, will there be errors
      // if I call stop?
      if (err) {
        // console.log("ERR:", err);
        // console.log("No such container, resolving ..");
        // reject();
        console.log("No such container running. Returning.");
        resolve();
      }
      console.log("Stopped. Removing ..");
      old.remove((err, data) => {
        if (err) {
          console.log("ERR:", err);
          reject("ERROR!!!");
          // resolve();
        }
        console.log("removed successfully");
        resolve();
      });
    });
  });
}

// return promise of IP address
async function createContainer(image, name) {
  return new Promise((resolve, reject) => {
    var docker = new Docker();
    // spawn("docker", ["run", "-d", "jp-julia"]);
    // 1. first check if the container already there. If so, stop and delete
    // let name = "julia_kernel_X";
    console.log("spawning kernel ..");
    docker.createContainer(
      { Image: image, name, NetworkMode: "codepod" },
      (err, container) => {
        if (err) {
          console.log("ERR:", err);
          return;
        }
        container.start((err, data) => {
          console.log("Container started!");
          // console.log(container);
          container.inspect((err, data) => {
            // console.log("inspect");
            // let ip = data.NetworkSettings.IPAddress
            //
            // If created using codepod network bridge, the IP is here:
            let ip = data.NetworkSettings.Networks.codepod.IPAddress;
            console.log("IP:", ip);
            resolve(ip);
          });
          // console.log("IPaddress:", container.NetworkSettings.IPAddress)
        });
      }
    );
  });
}

export class CodePodKernel {
  async init(sessionId) {
    // fname = await genConnSpec();
    this.sessionId = sessionId;
    let name = `cpkernel_${sessionId}_${this.lang}`;
    await removeContainer(name);
    let ip = await createContainer(this.image, name);
    // FIXME I don't want to extend Kernel, I'm using composition
    console.log("connecting to zmq ..");
    this.wire = new ZmqWire(this.fname, ip);
    console.log("executing startup file ..");
    let startupCode = readFileSync(this.startupFile, "utf8");
    this.wire.sendShellMessage(
      constructExecuteRequest({ code: startupCode, msg_id: "CODEPOD" })
    );
    console.log("kernel initialized successfully");
    // so that we can chain methods
    return this;
  }
  async kill() {
    // FIXME dispose the this.wire
    //
    // FIXME actually I do not want to stop the connection. Instead, I want to
    // keep the kernel without the kernel. The kernel status should show unknow
    // on the browser. The browser wound need to reinit the kernel. So try to
    // differentiate connect and startKernel. For now, I'll just provide a way
    // to shutdown the kernels easily.
    //
    // remove container
    let name = `cpkernel_${this.sessionId}_${this.lang}`;
    await removeContainer(name);
  }
  runCode({ code, msg_id }) {
    this.wire.sendShellMessage(
      constructExecuteRequest({
        code,
        msg_id,
      })
    );
  }
  requestKernelStatus() {
    this.wire.sendShellMessage(
      constructMessage({ msg_type: "kernel_info_request" })
    );
  }
  // 2. runCode
  eval({ code, podId, namespace, midports }) {
    this.runCode({
      code: this.mapEval({ code, namespace }),
      msg_id: podId,
    });
  }
  evalRaw({ code, podId }) {
    this.runCode({
      code,
      msg_id: podId,
    });
  }
  // 4. addImport
  addImport({ id, from, to, name }) {
    this.runCode({
      code: this.mapAddImport({ from, to, name }),
      msg_id: id + "#" + name,
    });
  }
  // 5. deleteImport
  deleteImport({ id, ns, name }) {
    this.runCode({
      code: this.mapDeleteImport({ ns, name }),
      msg_id: id + "#" + name,
    });
  }
  // 6. ensureImports
  ensureImports({ id, from, to, names }) {
    for (let name of names) {
      // only python needs to re-evaluate for imports
      this.runCode({
        code: this.mapEnsureImports({ from, to, name }),
        msg_id: id + "#" + name,
      });
    }
  }

  // FIXME default implementation should throw errors
  // mapEval() {}
  // mapAddImport() {}
  // mapDeleteImport() {}
  // mapEnsureImports() {}
}

export async function createKernel({ lang, sessionId }) {
  switch (lang) {
    case "julia":
      return await new JuliaKernel().init(sessionId);
    case "js":
      return await new JavascriptKernel().init(sessionId);
    case "racket":
      return await new RacketKernel().init(sessionId);
    case "python":
      return await new PythonKernel().init(sessionId);
    default:
      console.log("ERROR: language not implemented", lang);
    // throw new Error(`Language not valid: ${lang}`);
  }
}

export class JuliaKernel extends CodePodKernel {
  startupFile = "./kernels/julia/codepod.jl";
  // TODO fname is not necessary, I just need a fixed port.
  fname = "./kernels/julia/conn.json";
  lang = "julia";
  image = "julia_kernel";
  mapEval({ code, namespace }) {
    return `CODEPOD_EVAL("""${code}""", "${namespace}")`;
  }
  mapAddImport({ from, to, name }) {
    return `CODEPOD_ADD_IMPORT("${from}", "${to}", "${name}")`;
  }
  mapDeleteImport({ ns, name }) {
    return `CODEPOD_DELETE_IMPORT("${ns}", "${name}")`;
  }
}

export class PythonKernel extends CodePodKernel {
  startupFile = "./kernels/python/codepod.py";
  fname = "./kernels/python/conn.json";
  lang = "python";
  image = "python_kernel";
  mapEval({ code, namespace }) {
    return `CODEPOD_EVAL("""${code.replaceAll('"', '\\"')}""", "${namespace}")`;
  }
  mapAddImport({ from, to, name }) {
    // FIXME this should be re-evaluated everytime the function changes
    // I cannot use importlib because the module here lacks the finder, and
    // some other attribute functions
    return `CODEPOD_EVAL("""${name} = CODEPOD_GETMOD("${from}").__dict__["${name}"]\n0""", "${to}")`;
  }
  mapDeleteImport({ ns, name }) {
    return `CODEPOD_EVAL("del ${name}", "${ns}")`;
  }
  mapEnsureImports({ from, to, name }) {
    return `CODEPOD_EVAL("""${name} = CODEPOD_GETMOD("${from}").__dict__["${name}"]\n0""", "${to}")`;
  }
}

export class RacketKernel extends CodePodKernel {
  startupFile = "./kernels/racket/codepod.rkt";
  fname = "./kernels/racket/conn.json";
  lang = "racket";
  image = "racket_kernel";
  mapEval({ code, namespace }) {
    return `(enter! #f) (CODEPOD-EVAL "${code}" "${namespace}")`;
  }
  mapAddImport({ from, to, name }) {
    return `(enter! #f) (CODEPOD-ADD-IMPORT "${from}" "${to}" "${name}")`;
  }
  mapDeleteImport({ ns, name }) {
    return `(enter! #f) (CODEPOD-DELETE-IMPORT "${ns}" "${name}")`;
  }
}

export class JavascriptKernel extends CodePodKernel {
  startupFile = "./kernels/javascript/codepod.js";
  fname = "./kernels/javascript/conn.json";
  lang = "javascript";
  image = "javascript_kernel";
  mapEval({ code, namespace, midports }) {
    let names = [];
    if (midports) {
      names = midports.map((name) => `"${name}"`);
    }
    let code1 = `CODEPOD.eval(\`${code}\`, "${namespace}", [${names.join(
      ","
    )}])`;
    return code1;
  }
  mapAddImport({ from, to, name }) {
    return `CODEPOD.addImport("${from}", "${to}", "${name}")`;
  }
  mapDeleteImport({ ns, name }) {
    return `CODEPOD.deleteImport("${ns}", "${name}")`;
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function genConnSpec() {
  // ensure directory exist
  if (!fs.existsSync("./conns")) {
    fs.mkdirSync("./conns");
  }
  let fname = `./conns/${uuidv4()}.json`;
  let spec = await createNewConnSpec();
  writeFileSync(fname, JSON.stringify(spec));
  return fname;
}
