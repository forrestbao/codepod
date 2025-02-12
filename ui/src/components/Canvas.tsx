import {
  useCallback,
  useState,
  useRef,
  useContext,
  useEffect,
  memo,
  ChangeEvent,
} from "react";
import * as React from "react";
import ReactFlow, {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  MiniMap,
  Controls,
  Handle,
  useReactFlow,
  Position,
  ConnectionMode,
  MarkerType,
  Node,
  ReactFlowProvider,
  Edge,
  useViewport,
  XYPosition,
} from "reactflow";
import "reactflow/dist/style.css";

import Box from "@mui/material/Box";

import { customAlphabet } from "nanoid";
import { lowercase, numbers } from "nanoid-dictionary";

import { useStore } from "zustand";

import { RepoContext } from "../lib/store";
import { useEdgesYjsObserver, useYjsObserver } from "../lib/nodes";

import { useApolloClient } from "@apollo/client";
import { CanvasContextMenu } from "./CanvasContextMenu";
import { ShareProjDialog } from "./ShareProjDialog";
import { RichNode } from "./nodes/Rich";
import { CodeNode } from "./nodes/Code";
import { ScopeNode } from "./nodes/Scope";
import { YMap } from "yjs/dist/src/types/YMap";
import FloatingEdge from "./nodes/FloatingEdge";
import CustomConnectionLine from "./nodes/CustomConnectionLine";
import HelperLines from "./HelperLines";
import { getAbsPos, newNodeShapeConfig } from "../lib/store/canvasSlice";

const nodeTypes = { SCOPE: ScopeNode, CODE: CodeNode, RICH: RichNode };
const edgeTypes = {
  floating: FloatingEdge,
};

/**
 * This hook will load nodes from zustand store into Yjs nodesMap using setNodes.
 * @returns None
 */
function store2nodes(id: string, { getId2children, getPod }) {
  let res: any[] = [];
  let children = getId2children(id) || [];
  const pod = getPod(id);
  if (id !== "ROOT") {
    res.push({
      id: id,
      type: pod.type,
      data: {
        // label: `ID: ${id}, parent: ${pods[id].parent}, pos: ${pods[id].x}, ${pods[id].y}`,
        label: id,
        name: pod.name,
        parent: pod.parent,
      },
      // position: { x: 100, y: 100 },
      position: { x: pod.x, y: pod.y },
      parentNode: pod.parent !== "ROOT" ? pod.parent : undefined,
      style: {
        width: pod.width || undefined,
        height: pod.height || undefined,
      },
      width: pod.width || undefined,
      // for code node, don't set height, let it be auto
      height: pod.height || undefined,
      dragHandle: ".custom-drag-handle",
    });
  }
  for (const child of children) {
    res = res.concat(store2nodes(child, { getId2children, getPod }));
  }
  return res;
}

function verifyConsistency(nodes: Node[], nodesMap: YMap<Node>) {
  let keys = new Set(nodesMap.keys());
  let nodesMap2 = new Map<string, Node>();
  nodes.forEach((node) => nodesMap2.set(node.id, node));
  let keys2 = new Set(nodesMap2.keys());
  if (keys.size !== keys2.size) {
    console.error("key sizes are not the same", keys, keys2);
    return false;
  }
  for (let i = 0; i < keys.size; i++) {
    if (keys[i] !== keys2[i]) {
      console.error("keys are not the same", keys, keys2);
      return false;
    }
  }
  // verify the values
  for (let key of Array.from(keys)) {
    let node1 = nodesMap.get(key);
    let node2 = nodesMap2.get(key);
    if (!node1) {
      console.error("node1 is undefined");
      return false;
    }
    if (!node2) {
      console.error("node2 is undefined");
      return false;
    }
    if (node1.id !== node2.id) {
      console.error("node id are not the same", node1.id, node2.id, "key", key);
      return false;
    }
    if (node1.parentNode !== node2.parentNode) {
      console.error(
        "node parent are not the same",
        node1.parentNode,
        node2.parentNode
      );
      return false;
    }

    // FIXME: Number.EPSILON is still too huge to compare two floats
    if (Math.abs(node1.position.x - node2.position.x) > 0.01) {
      console.error(
        "node x are not the same",
        node1.position.x,
        node2.position.x
      );
      return false;
    }
    if (Math.abs(node1.position.y - node2.position.y) > 0.01) {
      console.error(
        "node y are not the same",
        node1.position.y,
        node2.position.y
      );
      return false;
    }
  }
  return true;
}

function verifyEdgeConsistency(edges: Edge[], edgesMap: YMap<Edge>) {
  let keys = new Set(edgesMap.keys());
  let edgesMap2 = new Map<string, Edge>();
  edges.forEach((edge) => edgesMap2.set(edge.id, edge));
  let keys2 = new Set(edgesMap2.keys());
  if (keys.size !== keys2.size) {
    console.error("key sizes are not the same", keys, keys2);
    return false;
  }
  for (let i = 0; i < keys.size; i++) {
    if (keys[i] !== keys2[i]) {
      console.error("keys are not the same", keys, keys2);
      return false;
    }
  }
  // verify the values
  for (let key of Array.from(keys)) {
    let edge1 = edgesMap.get(key);
    let edge2 = edgesMap2.get(key);
    if (!edge1) {
      console.error("edge1 is undefined");
      return false;
    }
    if (!edge2) {
      console.error("edge2 is undefined");
      return false;
    }
    if (edge1.id !== edge2.id) {
      console.error("edge id are not the same", edge1.id, edge2.id, "key", key);
      return false;
    }
    if (edge1.source !== edge2.source) {
      console.error("edge source are not the same", edge1.source, edge2.source);
      return false;
    }
    if (edge1.target !== edge2.target) {
      console.error("edge target are not the same", edge1.target, edge2.target);
      return false;
    }
  }
  return true;
}

function useInitNodes() {
  const store = useContext(RepoContext)!;
  const getPod = useStore(store, (state) => state.getPod);
  const nodesMap = useStore(store, (state) => state.ydoc.getMap<Node>("pods"));
  const edgesMap = useStore(store, (state) => state.ydoc.getMap<Edge>("edges"));
  const arrows = useStore(store, (state) => state.arrows);
  const getId2children = useStore(store, (state) => state.getId2children);
  const provider = useStore(store, (state) => state.provider);
  const [loading, setLoading] = useState(true);
  const updateView = useStore(store, (state) => state.updateView);
  const updateEdgeView = useStore(store, (state) => state.updateEdgeView);
  const adjustLevel = useStore(store, (state) => state.adjustLevel);
  const buildNode2Children = useStore(
    store,
    (state) => state.buildNode2Children
  );
  useEffect(() => {
    const init = () => {
      let nodes = store2nodes("ROOT", { getId2children, getPod });
      let isConsistent = verifyConsistency(nodes, nodesMap);
      if (!isConsistent) {
        console.warn(
          "The yjs server is not consistent with the database. Resetting the yjs server"
        );
        // Not only should we set nodes, but also delete.
        nodesMap.clear();
        // add the nodes, so that the nodesMap is consistent with the database.
        nodes.forEach((node) => {
          nodesMap.set(node.id, node);
        });
      }
      // NOTE we have to trigger an update here, otherwise the nodes are not
      // rendered.
      // triggerUpdate();
      // adjust level and update view
      adjustLevel();
      updateView();
      // handling the arrows
      isConsistent = verifyEdgeConsistency(
        arrows.map(({ source, target }) => ({
          source,
          target,
          id: `${source}_${target}`,
        })),
        edgesMap
      );
      if (!isConsistent) {
        console.warn("The yjs server is not consistent with the database.");
        // delete the old keys
        edgesMap.clear();
        arrows.forEach(({ target, source }) => {
          const edge: Edge = {
            id: `${source}_${target}`,
            source,
            sourceHandle: "top",
            target,
            targetHandle: "top",
          };
          edgesMap.set(edge.id, edge);
          // This isn't working. I need to set {edges} manually (from edgesMap)
          // reactFlowInstance.addEdges(edge);
        });
      }
      updateEdgeView();
      setLoading(false);
      buildNode2Children();
    };

    if (!provider) return;
    if (provider.synced) {
      init();
    } else {
      provider.once("synced", init);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);
  return { loading };
}

function getBestNode(
  nodes: Node[],
  from,
  direction: "up" | "down" | "left" | "right"
) {
  // find the best node to jump to from (x,y) in the given direction
  let bestNode: Node | null = null;
  let bestDistance = Infinity;
  nodes = nodes.filter((node) => {
    switch (direction) {
      case "up":
        return (
          node.position.y + node.height! / 2 <
          from.position.y + from.height! / 2
        );
      case "down":
        return (
          node.position.y + node.height! / 2 >
          from.position.y + from.height! / 2
        );
      case "left":
        return (
          node.position.x + node.width! / 2 < from.position.x + from.width! / 2
        );
      case "right":
        return (
          node.position.x + node.width! / 2 > from.position.x + from.width! / 2
        );
    }
  });
  for (let node of nodes) {
    // I should start from the edge, instead of the center
    const startPoint: XYPosition = (() => {
      // the center
      // return {
      //   x: from.position.x + from.width! / 2,
      //   y: from.position.y + from.height! / 2,
      // };
      // the edge depending on direction.
      switch (direction) {
        case "up":
          return {
            x: from.position.x + from.width! / 2,
            y: from.position.y,
          };
        case "down":
          return {
            x: from.position.x + from.width! / 2,
            y: from.position.y + from.height!,
          };
        case "left":
          return {
            x: from.position.x,
            y: from.position.y + from.height! / 2,
          };
        case "right":
          return {
            x: from.position.x + from.width!,
            y: from.position.y + from.height! / 2,
          };
      }
    })();
    let distance =
      Math.pow(node.position.x + node.width! / 2 - startPoint.x, 2) *
        (["left", "right"].includes(direction) ? 1 : 2) +
      Math.pow(node.position.y + node.height! / 2 - startPoint.y, 2) *
        (["up", "down"].includes(direction) ? 1 : 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestNode = node;
    }
  }
  return bestNode;
}

function useJump() {
  const store = useContext(RepoContext)!;

  const selectPod = useStore(store, (state) => state.selectPod);
  const resetSelection = useStore(store, (state) => state.resetSelection);
  const nodesMap = useStore(store, (state) => state.ydoc.getMap<Node>("pods"));

  const reactflow = useReactFlow();

  const selectedPods = useStore(store, (state) => state.selectedPods);
  const handleKeyDown = (event) => {
    // Only handle the arrow keys.
    switch (event.key) {
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight":
        break;
      default:
        return;
    }
    // Get the selected node.
    const id = selectedPods.values().next().value; // Assuming only one node can be selected at a time
    if (!id) {
      console.log("No node selected");
      return; // Ignore arrow key presses if there's no selected node or if the user is typing in an input field
    }
    const pod = nodesMap.get(id);
    if (!pod) {
      console.log("pod is undefined");
      return;
    }

    // get the sibling nodes
    const nodes = Array.from(nodesMap.values()).filter(
      (node) => node.parentNode === pod.parentNode
    );

    let to: null | Node = null;

    switch (event.key) {
      case "ArrowUp":
        to = getBestNode(nodes, pod, "up");
        break;
      case "ArrowDown":
        to = getBestNode(nodes, pod, "down");
        break;
      case "ArrowLeft":
        to = getBestNode(nodes, pod, "left");
        break;
      case "ArrowRight":
        to = getBestNode(nodes, pod, "right");
        break;
      default:
        return;
    }

    if (to) {
      // set the to node as selected
      resetSelection();
      selectPod(to.id, true);
      // move the viewport to the to node
      // get the absolute position of the to node
      const pos = getAbsPos(to, nodesMap);

      reactflow.setCenter(pos.x + to.width! / 2, pos.y + to.height! / 2, {
        zoom: reactflow.getZoom(),
        duration: 800,
      });
    }

    event.preventDefault(); // Prevent default browser behavior for arrow keys
  };

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedPods]);
}

function usePaste(reactFlowWrapper) {
  const store = useContext(RepoContext);
  if (!store) throw new Error("Missing BearContext.Provider in the tree");

  const reactFlowInstance = useReactFlow();

  const pasteBegin = useStore(store, (state) => state.pasteBegin);
  const onPasteMove = useStore(store, (state) => state.onPasteMove);
  const pasteEnd = useStore(store, (state) => state.pasteEnd);
  const cancelPaste = useStore(store, (state) => state.cancelPaste);
  const isPasting = useStore(store, (state) => state.isPasting);
  const isCutting = useStore(store, (state) => state.isCutting);
  const isGuest = useStore(store, (state) => state.role === "GUEST");
  const isPaneFocused = useStore(store, (state) => state.isPaneFocused);
  const resetSelection = useStore(store, (state) => state.resetSelection);

  useEffect(() => {
    if (!reactFlowWrapper.current) return;
    if (!isPasting) return;

    const mouseMove = (event) => {
      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });
      onPasteMove(position);
    };
    const mouseClick = (event) => {
      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });
      pasteEnd(position, false);
    };
    const keyDown = (event) => {
      if (event.key !== "Escape") return;
      // delete the temporary node
      cancelPaste(false);
      //clear the pasting state
      event.preventDefault();
    };
    reactFlowWrapper.current.addEventListener("mousemove", mouseMove);
    reactFlowWrapper.current.addEventListener("click", mouseClick);
    document.addEventListener("keydown", keyDown);
    return () => {
      if (reactFlowWrapper.current) {
        reactFlowWrapper.current.removeEventListener("mousemove", mouseMove);
        reactFlowWrapper.current.removeEventListener("click", mouseClick);
      }
      document.removeEventListener("keydown", keyDown);
    };
  }, [
    cancelPaste,
    onPasteMove,
    pasteEnd,
    isPasting,
    reactFlowInstance,
    reactFlowWrapper,
  ]);

  const handlePaste = useCallback(
    (event) => {
      // avoid duplicated pastes
      // check if the pane is focused
      if (isPasting || isCutting || isGuest || !isPaneFocused) return;

      try {
        // the user clipboard data is unpreditable, may have application/json
        // from other source that can't be parsed by us, use try-catch here.
        const payload = event.clipboardData.getData("application/json");
        const data = JSON.parse(payload);
        if (data?.type !== "pod") {
          return;
        }
        // clear the selection, make the temporary front-most
        resetSelection();

        // paste at the center of the pane
        const reactFlowBounds =
          reactFlowWrapper.current.getBoundingClientRect();
        let [posX, posY] = [
          reactFlowBounds.width / 2,
          reactFlowBounds.height / 2,
        ];

        const position = reactFlowInstance.project({ x: posX, y: posY });
        pasteBegin(position, data.data, false);
      } catch (e) {
        console.log("paste error", e);
      }
    },
    [
      isGuest,
      isPasting,
      pasteBegin,
      reactFlowInstance,
      reactFlowWrapper,
      resetSelection,
      isPaneFocused,
    ]
  );

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => {
      document.removeEventListener("paste", handlePaste);
    };
  }, [handlePaste]);
}

function useCut(reactFlowWrapper) {
  const store = useContext(RepoContext);
  if (!store) throw new Error("Missing BearContext.Provider in the tree");

  const reactFlowInstance = useReactFlow();

  const cutEnd = useStore(store, (state) => state.cutEnd);
  const onCutMove = useStore(store, (state) => state.onCutMove);
  const cancelCut = useStore(store, (state) => state.cancelCut);
  const isCutting = useStore(store, (state) => state.isCutting);
  const isPasting = useStore(store, (state) => state.isPasting);
  const isGuest = useStore(store, (state) => state.role === "GUEST");
  const apolloClient = useApolloClient();

  useEffect(() => {
    if (!reactFlowWrapper.current) return;
    if (!isCutting) return;

    const mouseMove = (event) => {
      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });
      onCutMove(position);
    };
    const mouseClick = (event) => {
      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });
      cutEnd(position, reactFlowInstance);
    };
    const keyDown = (event) => {
      if (event.key !== "Escape") return;
      // delete the temporary node
      cancelCut();
      //clear the pasting state
      event.preventDefault();
    };
    reactFlowWrapper.current.addEventListener("mousemove", mouseMove);
    reactFlowWrapper.current.addEventListener("click", mouseClick);
    document.addEventListener("keydown", keyDown);
    return () => {
      if (reactFlowWrapper.current) {
        reactFlowWrapper.current.removeEventListener("mousemove", mouseMove);
        reactFlowWrapper.current.removeEventListener("click", mouseClick);
      }
      document.removeEventListener("keydown", keyDown);
    };
  }, [
    cancelCut,
    cutEnd,
    isCutting,
    isPasting,
    apolloClient,
    onCutMove,
    reactFlowInstance,
    reactFlowWrapper,
  ]);
}

/**
 * The ReactFlow instance keeps re-rendering when nodes change. Thus, we're
 * using this wrapper component to load the useXXX functions only once.
 */
function CanvasImplWrap() {
  // This wrapper is not the exact same <div> as the reactFlowWrapper in
  // CanvasImpl, but they are exactly the same when using the bounding-box.
  const reactFlowWrapper = useRef<any>(null);

  useYjsObserver();
  useEdgesYjsObserver();
  usePaste(reactFlowWrapper);
  useCut(reactFlowWrapper);
  useJump();

  const { loading } = useInitNodes();
  if (loading) return <div>Loading...</div>;
  return (
    <Box sx={{ height: "100%" }} ref={reactFlowWrapper}>
      <CanvasImpl />
      <ViewportInfo />
    </Box>
  );
}

function ViewportInfo() {
  const store = useContext(RepoContext);
  if (!store) throw new Error("Missing BearContext.Provider in the tree");
  const { x, y, zoom } = useViewport();
  return (
    <Box
      sx={{
        position: "absolute",
        bottom: 0,
        right: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        color: "white",
        padding: 1,
        fontSize: 12,
        borderRadius: 1,
        zIndex: 100,
      }}
    >
      {`x: ${x.toFixed(2)}, y: ${y.toFixed(2)}, zoom: ${zoom.toFixed(2)}`}
    </Box>
  );
}

/**
 * The canvas.
 * @returns
 */
function CanvasImpl() {
  const reactFlowWrapper = useRef<any>(null);

  const store = useContext(RepoContext);
  if (!store) throw new Error("Missing BearContext.Provider in the tree");

  const nodes = useStore(store, (state) => state.nodes);
  const edges = useStore(store, (state) => state.edges);
  const apolloClient = useApolloClient();
  const onNodesChange = useStore(store, (state) =>
    state.onNodesChange(apolloClient)
  );
  const onEdgesChange = useStore(store, (state) =>
    state.onEdgesChange(apolloClient)
  );
  const onConnect = useStore(store, (state) => state.onConnect(apolloClient));
  const moveIntoScope = useStore(store, (state) => state.moveIntoScope);
  const setDragHighlight = useStore(store, (state) => state.setDragHighlight);
  const removeDragHighlight = useStore(
    store,
    (state) => state.removeDragHighlight
  );
  const updateView = useStore(store, (state) => state.updateView);
  const autoLayoutROOT = useStore(store, (state) => state.autoLayoutROOT);

  const addNode = useStore(store, (state) => state.addNode);
  const importLocalCode = useStore(store, (state) => state.importLocalCode);
  const reactFlowInstance = useReactFlow();

  const project = useCallback(
    ({ x, y }) => {
      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      return reactFlowInstance.project({
        x: x - reactFlowBounds.left,
        y: y - reactFlowBounds.top,
      });
    },
    [reactFlowInstance]
  );

  const repoId = useStore(store, (state) => state.repoId);
  const isGuest = useStore(store, (state) => state.role === "GUEST");

  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const shareOpen = useStore(store, (state) => state.shareOpen);
  const setShareOpen = useStore(store, (state) => state.setShareOpen);
  const setPaneFocus = useStore(store, (state) => state.setPaneFocus);
  const setPaneBlur = useStore(store, (state) => state.setPaneBlur);

  const [showContextMenu, setShowContextMenu] = useState(false);
  const [points, setPoints] = useState({ x: 0, y: 0 });
  const [client, setClient] = useState({ x: 0, y: 0 });
  const [parentNode, setParentNode] = useState("ROOT");

  const onPaneContextMenu = (event) => {
    event.preventDefault();
    setShowContextMenu(true);
    setParentNode("ROOT");
    setPoints({ x: event.pageX, y: event.pageY });
    setClient({ x: event.clientX, y: event.clientY });
  };

  const onNodeContextMenu = (event, node) => {
    if (node?.type !== "SCOPE") return;

    event.preventDefault();
    setShowContextMenu(true);
    setParentNode(node.id);
    setPoints({ x: event.pageX, y: event.pageY });
    setClient({ x: event.clientX, y: event.clientY });
  };

  useEffect(() => {
    const handleClick = (event) => {
      setShowContextMenu(false);
      const target = event.target;
      // set the pane focused only when the clicked target is pane or the copy buttons on a pod
      // then we can paste right after click on the copy buttons
      if (
        target.className === "react-flow__pane" ||
        target.classList?.contains("copy-button") ||
        target.parentElement?.classList?.contains("copy-button")
      ) {
        setPaneFocus();
      } else {
        setPaneBlur();
      }
    };
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
    };
  }, [setShowContextMenu, setPaneFocus, setPaneBlur]);

  const getScopeAtPos = useStore(store, (state) => state.getScopeAtPos);
  const autoRunLayout = useStore(store, (state) => state.autoRunLayout);
  const setAutoLayoutOnce = useStore(store, (state) => state.setAutoLayoutOnce);
  const autoLayoutOnce = useStore(store, (state) => state.autoLayoutOnce);

  const helperLineHorizontal = useStore(
    store,
    (state) => state.helperLineHorizontal
  );
  const helperLineVertical = useStore(
    store,
    (state) => state.helperLineVertical
  );
  const toggleMoved = useStore(store, (state) => state.toggleMoved);
  const toggleClicked = useStore(store, (state) => state.toggleClicked);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleItemClick = () => {
    fileInputRef!.current!.click();
    fileInputRef!.current!.value = "";
  };

  const handleFileInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const fileName = e.target.files[0].name;
    console.log("Import Jupyter Notebook or Python scripts: ", fileName);
    const fileReader = new FileReader();
    fileReader.onload = (e) => {
      const fileContent =
        typeof e.target!.result === "string"
          ? e.target!.result
          : Buffer.from(e.target!.result!).toString();
      let cellList: any[] = [];
      let importScopeName = "";
      switch (fileName.split(".").pop()) {
        case "ipynb":
          cellList = JSON.parse(String(fileContent)).cells.map((cell) => ({
            cellType: cell.cell_type,
            cellSource: cell.source.join(""),
          }));
          importScopeName = fileName.substring(0, fileName.length - 6);
          break;
        case "py":
          cellList = [{ cellType: "code", cellSource: String(fileContent) }];
          break;
        default:
          return;
      }

      importLocalCode(
        project({ x: client.x, y: client.y }),
        importScopeName,
        cellList
      );
      setAutoLayoutOnce(true);
    };
    fileReader.readAsText(e.target.files[0], "UTF-8");
  };

  useEffect(() => {
    // A BIG HACK: we run autolayout once at SOME point after ImportLocalCode to
    // let reactflow calculate the height of pods, then layout them properly.
    if (
      autoLayoutOnce &&
      nodes.filter((node) => node.height === newNodeShapeConfig.height)
        .length == 0
    ) {
      autoLayoutROOT();
      setAutoLayoutOnce(false);
    }
  }, [autoLayoutOnce, nodes]);

  return (
    <Box
      style={{
        display: "flex",
        height: "100%",
        flexDirection: "column",
      }}
    >
      <Box sx={{ height: "100%" }} ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onMove={() => {
            toggleMoved();
          }}
          onPaneClick={() => {
            toggleClicked();
          }}
          onNodeDragStop={(event, node) => {
            removeDragHighlight();
            let mousePos = project({ x: event.clientX, y: event.clientY });
            let scope = getScopeAtPos(mousePos, node.id);
            let toScope = scope ? scope.id : "ROOT";
            const parentScope = node.parentNode ? node.parentNode : "ROOT";
            if (toScope !== parentScope) {
              moveIntoScope(node.id, toScope);
            }
            // update view manually to remove the drag highlight.
            updateView();
            // run auto layout on drag stop
            if (autoRunLayout) {
              autoLayoutROOT();
            }
          }}
          onNodeDrag={(event, node) => {
            let mousePos = project({ x: event.clientX, y: event.clientY });
            let scope = getScopeAtPos(mousePos, node.id);
            if (scope) {
              // The view is updated at the node position change.
              setDragHighlight(scope.id);
            } else {
              removeDragHighlight();
            }
          }}
          attributionPosition="top-right"
          maxZoom={10}
          minZoom={0.1}
          onPaneContextMenu={onPaneContextMenu}
          onNodeContextMenu={onNodeContextMenu}
          nodeTypes={nodeTypes}
          // custom edge for easy connect
          edgeTypes={edgeTypes}
          defaultEdgeOptions={{
            style: { strokeWidth: 3, stroke: "black" },
            type: "floating",
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: "black",
            },
          }}
          connectionLineComponent={CustomConnectionLine}
          connectionLineStyle={{
            strokeWidth: 3,
            stroke: "black",
          }}
          // end custom edge

          zoomOnScroll={false}
          panOnScroll={true}
          connectionMode={ConnectionMode.Loose}
          nodesDraggable={!isGuest}
          // disable node delete on backspace when the user is a guest.
          deleteKeyCode={isGuest ? null : "Backspace"}
          multiSelectionKeyCode={isMac ? "Meta" : "Control"}
          // TODO restore previous viewport
          defaultViewport={{ zoom: 1, x: 0, y: 0 }}
          proOptions={{ hideAttribution: true }}
          disableKeyboardA11y={true}
        >
          <Box>
            <MiniMap
              nodeStrokeColor={(n) => {
                if (n.style?.borderColor) return n.style.borderColor;
                if (n.type === "CODE") return "#d6dee6";
                if (n.type === "SCOPE") return "#f4f6f8";

                return "#d6dee6";
              }}
              nodeColor={(n) => {
                if (n.style?.backgroundColor) return n.style.backgroundColor;

                return "#f4f6f8";
              }}
              nodeBorderRadius={2}
            />
            <Controls showInteractive={!isGuest} />

            <HelperLines
              horizontal={helperLineHorizontal}
              vertical={helperLineVertical}
            />

            <Background />
            <Background
              id="1"
              gap={10}
              color="#f1f1f1"
              variant={BackgroundVariant.Lines}
            />
            <Background
              id="2"
              gap={100}
              offset={1}
              color="#ccc"
              variant={BackgroundVariant.Lines}
            />
          </Box>
        </ReactFlow>
        <input
          type="file"
          accept=".ipynb, .py"
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={(e) => handleFileInputChange(e)}
        />
        {showContextMenu && (
          <CanvasContextMenu
            x={points.x}
            y={points.y}
            addCode={() =>
              addNode("CODE", project({ x: client.x, y: client.y }), parentNode)
            }
            addScope={() =>
              addNode(
                "SCOPE",
                project({ x: client.x, y: client.y }),
                parentNode
              )
            }
            addRich={() =>
              addNode("RICH", project({ x: client.x, y: client.y }), parentNode)
            }
            handleImportClick={() => {
              // handle CanvasContextMenu "import Jupyter notebook" click
              handleItemClick();
            }}
            onShareClick={() => {
              setShareOpen(true);
            }}
            parentNode={null}
          />
        )}
        {shareOpen && <ShareProjDialog open={shareOpen} id={repoId || ""} />}
      </Box>
    </Box>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasImplWrap />
    </ReactFlowProvider>
  );
}
