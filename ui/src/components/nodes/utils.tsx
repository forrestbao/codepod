import {
  Position,
  internalsSymbol,
  Node,
  NodePositionChange,
  XYPosition,
} from "reactflow";

import { useContext } from "react";

import Button from "@mui/material/Button";

import { useStore } from "zustand";

import { RepoContext } from "../../lib/store";

export function ResizeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      strokeWidth="2"
      stroke="#ff0071"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ position: "absolute", right: 5, bottom: 5 }}
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <polyline points="16 20 20 20 20 16" />
      <line x1="14" y1="14" x2="20" y2="20" />
      <polyline points="8 4 4 4 4 8" />
      <line x1="4" y1="4" x2="10" y2="10" />
    </svg>
  );
}

// returns the position (top,right,bottom or right) passed node compared to
function getParams(nodeA, nodeB) {
  const centerA = getNodeCenter(nodeA);
  const centerB = getNodeCenter(nodeB);

  const horizontalDiff = Math.abs(centerA.x - centerB.x);
  const verticalDiff = Math.abs(centerA.y - centerB.y);

  let position;

  // when the horizontal difference between the nodes is bigger, we use Position.Left or Position.Right for the handle
  if (horizontalDiff > verticalDiff) {
    position = centerA.x > centerB.x ? Position.Left : Position.Right;
  } else {
    // here the vertical difference between the nodes is bigger, so we use Position.Top or Position.Bottom for the handle
    position = centerA.y > centerB.y ? Position.Top : Position.Bottom;
  }

  const [x, y] = getHandleCoordsByPosition(nodeA, position);
  return [x, y, position];
}

function getHandleCoordsByPosition(node, handlePosition) {
  // all handles are from type source, that's why we use handleBounds.source here
  const handle = node[internalsSymbol].handleBounds.source.find(
    (h) => h.position === handlePosition
  );

  let offsetX = handle.width / 2;
  let offsetY = handle.height / 2;

  // this is a tiny detail to make the markerEnd of an edge visible.
  // The handle position that gets calculated has the origin top-left, so depending which side we are using, we add a little offset
  // when the handlePosition is Position.Right for example, we need to add an offset as big as the handle itself in order to get the correct position
  switch (handlePosition) {
    case Position.Left:
      offsetX = 0;
      break;
    case Position.Right:
      offsetX = handle.width;
      break;
    case Position.Top:
      offsetY = 0;
      break;
    case Position.Bottom:
      offsetY = handle.height;
      break;
  }

  const x = node.positionAbsolute.x + handle.x + offsetX;
  const y = node.positionAbsolute.y + handle.y + offsetY;

  return [x, y];
}

function getNodeCenter(node) {
  return {
    x: node.positionAbsolute.x + node.width / 2,
    y: node.positionAbsolute.y + node.height / 2,
  };
}

// returns the parameters (sx, sy, tx, ty, sourcePos, targetPos) you need to create an edge
export function getEdgeParams(source, target) {
  const [sx, sy, sourcePos] = getParams(source, target);
  const [tx, ty, targetPos] = getParams(target, source);

  return {
    sx,
    sy,
    tx,
    ty,
    sourcePos,
    targetPos,
  };
}

type GetHelperLinesResult = {
  horizontal?: number;
  vertical?: number;
  snapPosition: Partial<XYPosition>;
};

// this utility function can be called with a position change (inside onNodesChange)
// it checks all other nodes and calculated the helper line positions and the position where the current node should snap to
export function getHelperLines(
  change: NodePositionChange,
  nodes: Node[],
  distance = 5
): GetHelperLinesResult {
  const defaultResult = {
    horizontal: undefined,
    vertical: undefined,
    snapPosition: { x: undefined, y: undefined },
  };
  const nodeA = nodes.find((node) => node.id === change.id);

  if (!nodeA || !change.position) {
    return defaultResult;
  }

  const nodeABounds = {
    left: change.position.x,
    right: change.position.x + (nodeA.width ?? 0),
    top: change.position.y,
    bottom: change.position.y + (nodeA.height ?? 0),
    width: nodeA.width ?? 0,
    height: nodeA.height ?? 0,
  };

  let horizontalDistance = distance;
  let verticalDistance = distance;

  return nodes
    .filter((node) => node.id !== nodeA.id)
    .reduce<GetHelperLinesResult>((result, nodeB) => {
      const nodeBBounds = {
        left: nodeB.position.x,
        right: nodeB.position.x + (nodeB.width ?? 0),
        top: nodeB.position.y,
        bottom: nodeB.position.y + (nodeB.height ?? 0),
        width: nodeB.width ?? 0,
        height: nodeB.height ?? 0,
      };

      //  |‾‾‾‾‾‾‾‾‾‾‾|
      //  |     A     |
      //  |___________|
      //  |
      //  |
      //  |‾‾‾‾‾‾‾‾‾‾‾|
      //  |     B     |
      //  |___________|
      const distanceLeftLeft = Math.abs(nodeABounds.left - nodeBBounds.left);

      if (distanceLeftLeft < verticalDistance) {
        result.snapPosition.x = nodeBBounds.left;
        result.vertical = nodeBBounds.left;
        verticalDistance = distanceLeftLeft;
      }

      //  |‾‾‾‾‾‾‾‾‾‾‾|
      //  |     A     |
      //  |___________|
      //              |
      //              |
      //  |‾‾‾‾‾‾‾‾‾‾‾|
      //  |     B     |
      //  |___________|
      const distanceRightRight = Math.abs(
        nodeABounds.right - nodeBBounds.right
      );

      if (distanceRightRight < verticalDistance) {
        result.snapPosition.x = nodeBBounds.right - nodeABounds.width;
        result.vertical = nodeBBounds.right;
        verticalDistance = distanceRightRight;
      }

      //              |‾‾‾‾‾‾‾‾‾‾‾|
      //              |     A     |
      //              |___________|
      //              |
      //              |
      //  |‾‾‾‾‾‾‾‾‾‾‾|
      //  |     B     |
      //  |___________|
      const distanceLeftRight = Math.abs(nodeABounds.left - nodeBBounds.right);

      if (distanceLeftRight < verticalDistance) {
        result.snapPosition.x = nodeBBounds.right;
        result.vertical = nodeBBounds.right;
        verticalDistance = distanceLeftRight;
      }

      //  |‾‾‾‾‾‾‾‾‾‾‾|
      //  |     A     |
      //  |___________|
      //              |
      //              |
      //              |‾‾‾‾‾‾‾‾‾‾‾|
      //              |     B     |
      //              |___________|
      const distanceRightLeft = Math.abs(nodeABounds.right - nodeBBounds.left);

      if (distanceRightLeft < verticalDistance) {
        result.snapPosition.x = nodeBBounds.left - nodeABounds.width;
        result.vertical = nodeBBounds.left;
        verticalDistance = distanceRightLeft;
      }

      //  |‾‾‾‾‾‾‾‾‾‾‾|‾‾‾‾‾|‾‾‾‾‾‾‾‾‾‾‾|
      //  |     A     |     |     B     |
      //  |___________|     |___________|
      const distanceTopTop = Math.abs(nodeABounds.top - nodeBBounds.top);

      if (distanceTopTop < horizontalDistance) {
        result.snapPosition.y = nodeBBounds.top;
        result.horizontal = nodeBBounds.top;
        horizontalDistance = distanceTopTop;
      }

      //  |‾‾‾‾‾‾‾‾‾‾‾|
      //  |     A     |
      //  |___________|_________________
      //                    |           |
      //                    |     B     |
      //                    |___________|
      const distanceBottomTop = Math.abs(nodeABounds.bottom - nodeBBounds.top);

      if (distanceBottomTop < horizontalDistance) {
        result.snapPosition.y = nodeBBounds.top - nodeABounds.height;
        result.horizontal = nodeBBounds.top;
        horizontalDistance = distanceBottomTop;
      }

      //  |‾‾‾‾‾‾‾‾‾‾‾|     |‾‾‾‾‾‾‾‾‾‾‾|
      //  |     A     |     |     B     |
      //  |___________|_____|___________|
      const distanceBottomBottom = Math.abs(
        nodeABounds.bottom - nodeBBounds.bottom
      );

      if (distanceBottomBottom < horizontalDistance) {
        result.snapPosition.y = nodeBBounds.bottom - nodeABounds.height;
        result.horizontal = nodeBBounds.bottom;
        horizontalDistance = distanceBottomBottom;
      }

      //                    |‾‾‾‾‾‾‾‾‾‾‾|
      //                    |     B     |
      //                    |           |
      //  |‾‾‾‾‾‾‾‾‾‾‾|‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾
      //  |     A     |
      //  |___________|
      const distanceTopBottom = Math.abs(nodeABounds.top - nodeBBounds.bottom);

      if (distanceTopBottom < horizontalDistance) {
        result.snapPosition.y = nodeBBounds.bottom;
        result.horizontal = nodeBBounds.bottom;
        horizontalDistance = distanceTopBottom;
      }

      return result;
    }, defaultResult);
}

export function NewPodButtons({ pod, xPos, yPos }) {
  const store = useContext(RepoContext);
  if (!store) throw new Error("Missing BearContext.Provider in the tree");
  const addNode = useStore(store, (state) => state.addNode);
  return (
    <>
      {/* Bottom 1 */}
      <Button
        variant="outlined"
        size="small"
        sx={{
          // place it at the BOTTOM of the pod, centered
          position: "absolute",
          bottom: "0px",
          left: "25%",
          transform: "translate(-50%, 50%)",
          zIndex: 100,
          whiteSpace: "nowrap",
          // opacity: showToolbar ? 0.5 : 0,
          opacity: 0,
          "&:hover": {
            opacity: 1,
          },
        }}
        onClick={() => {
          addNode("CODE", { x: xPos, y: yPos + pod!.height! + 50 }, pod.parent);
        }}
      >
        + Code
      </Button>

      {/* Bottom 2 */}
      <Button
        variant="outlined"
        size="small"
        sx={{
          position: "absolute",
          bottom: "0px",
          left: "75%",
          transform: "translate(-50%, 50%)",
          zIndex: 100,
          whiteSpace: "nowrap",
          // opacity: showToolbar ? 0.5 : 0,
          opacity: 0,
          "&:hover": {
            opacity: 1,
          },
        }}
        onClick={() => {
          addNode("RICH", { x: xPos, y: yPos + pod!.height! + 50 }, pod.parent);
        }}
      >
        + Note
      </Button>
      {/* Left 1 */}
      <Button
        variant="outlined"
        size="small"
        sx={{
          // place it at the LEFT of the pod, centered
          position: "absolute",
          top: "25%",
          left: "0px",
          transform: "translate(-50%, -50%)",
          zIndex: 100,
          whiteSpace: "nowrap",
          // opacity: showToolbar ? 0.5 : 0,
          opacity: 0,
          "&:hover": {
            opacity: 1,
          },
        }}
        onClick={() => {
          addNode("CODE", { x: xPos - pod!.width! - 50, y: yPos }, pod.parent);
        }}
      >
        + Code
      </Button>

      {/* Left 2 */}
      <Button
        variant="outlined"
        size="small"
        sx={{
          // place it at the LEFT of the pod, centered
          position: "absolute",
          top: "75%",
          left: "0px",
          transform: "translate(-50%, -50%)",
          zIndex: 100,
          whiteSpace: "nowrap",
          // opacity: showToolbar ? 0.5 : 0,
          opacity: 0,
          "&:hover": {
            opacity: 1,
          },
        }}
        onClick={() => {
          addNode("RICH", { x: xPos - pod!.width! - 50, y: yPos }, pod.parent);
        }}
      >
        + Note
      </Button>

      {/* Right 1 */}
      <Button
        variant="outlined"
        size="small"
        sx={{
          // place at the RIGHT of the pod, centered
          position: "absolute",
          top: "25%",
          right: "0px",
          transform: "translate(50%, -50%)",
          zIndex: 100,
          whiteSpace: "nowrap",
          // opacity: showToolbar ? 0.5 : 0,
          opacity: 0,
          "&:hover": {
            opacity: 1,
          },
        }}
        onClick={() => {
          addNode("CODE", { x: xPos + pod!.width! + 50, y: yPos }, pod.parent);
        }}
      >
        + Code
      </Button>

      {/* Right 2 */}
      <Button
        variant="outlined"
        size="small"
        sx={{
          // place at the RIGHT of the pod, centered
          position: "absolute",
          top: "75%",
          right: "0px",
          transform: "translate(50%, -50%)",
          zIndex: 100,
          whiteSpace: "nowrap",
          // opacity: showToolbar ? 0.5 : 0,
          opacity: 0,
          "&:hover": {
            opacity: 1,
          },
        }}
        onClick={() => {
          addNode("RICH", { x: xPos + pod!.width! + 50, y: yPos }, pod.parent);
        }}
      >
        + Note
      </Button>
    </>
  );
}
