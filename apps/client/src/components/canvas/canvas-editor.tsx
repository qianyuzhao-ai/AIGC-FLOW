"use client";

import {
  DEFAULT_IMAGE_GEN_DATA,
  DEFAULT_TEXT_NODE_DATA,
  DEFAULT_VIDEO_GEN_DATA,
  GROUP_NODE_TYPE,
  IMAGE_GEN_NODE_TYPE,
  MEDIA_NODE_TYPE,
  type MediaNodeData,
  type NodeMark,
  type Project,
  type ProjectGraph,
  syncPromptTokens,
  TEXT_NODE_HEIGHT,
  TEXT_NODE_TYPE,
  TEXT_NODE_WIDTH,
  VIDEO_GEN_NODE_TYPE,
} from "@aigc-flow/shared";
import {
  addEdge,
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  MiniMap,
  type Node,
  Panel,
  ReactFlow,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import { useTheme } from "next-themes";
import { type DragEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useProjectAgent } from "@/components/agent-workspace";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CanvasActionsProvider } from "@/hooks/use-canvas-actions";
import { useDesktopProject } from "@/hooks/use-desktop-project";
import { useGraphAutosave } from "@/hooks/use-graph-autosave";
import { useCanvasShortcuts, useGraphHistory } from "@/hooks/use-graph-history";
import { useMediaUpload } from "@/hooks/use-media-upload";
import type { CanvasBinding } from "@/lib/agent/canvas-tools";
import { retainGenerationResults } from "@/lib/agent/generation-results";
import {
  fromClipboardPayload,
  offsetToCenter,
  readClipboard,
  toClipboardPayload,
  writeClipboard,
} from "@/lib/clipboard";
import { canConnectNodes, sourceResourceOf, targetAcceptsOf } from "@/lib/connection";
import { downloadableMedia, downloadMedia } from "@/lib/download";
import { copiedNodeData, toPersistedGraph } from "@/lib/graph";
import {
  canGroup as canGroupNodes,
  groupChildIds,
  groupNodes,
  sameParentSelection,
  selectedGroupId,
  ungroupNodes,
} from "@/lib/group";
import {
  type AlignMode,
  alignNodes,
  arrangeNodes,
  type SpacingMode,
  spaceNodes,
} from "@/lib/layout";
import { idsByMark, markableIds, markNodes, markSummary } from "@/lib/node-mark";
import { AnimatedEdge } from "./animated-edge";
import { CanvasControls } from "./canvas-controls";
import { CanvasActionGroup, CanvasInfoGroup } from "./canvas-toolbar";
import { FloatingConnector, type FloatLine } from "./floating-connector";
import { GroupNode } from "./group-node";
import { ImageGenNode } from "./image-gen-node";
import { MediaNode } from "./media-node";
import { type CanvasMode, NodePalette } from "./node-palette";
import { NodePickerMenu, type NodePickerRequest, type PickerNodeType } from "./node-picker-menu";
import { SelectionToolbar } from "./selection-toolbar";
import { TextNode } from "./text-node";
import { VideoGenNode } from "./video-gen-node";
import "@xyflow/react/dist/style.css";

/** 连续粘贴时每次比上一次多错开的距离，副本压在原件上但露出一角 */
const PASTE_OFFSET = 40;

/**
 * 自带初始尺寸的节点类型：这几种可以自由拉伸，尺寸是用户定的、随 graph 落盘
 * （和 lib/graph.ts 的 SIZED_NODE_TYPES 是同一批）。其余类型由内容自适应。
 */
const INITIAL_SIZES: Record<string, { width: number; height: number }> = {
  [TEXT_NODE_TYPE]: { width: TEXT_NODE_WIDTH, height: TEXT_NODE_HEIGHT },
};

/** 组一个新节点 */
function buildCanvasNode(
  type: string,
  defaults: Record<string, unknown>,
  position: { x: number; y: number },
): Node {
  const size = INITIAL_SIZES[type] ?? null;
  return {
    id: crypto.randomUUID(),
    type,
    position,
    data: { ...defaults },
    ...(size ? { ...size, style: size } : {}),
  };
}

/** 副本相对原节点的偏移：压在原节点上但露出一角，一眼能看出多了一份，拖开即可 */
const DUPLICATE_OFFSET = 40;

/**
 * 原样复制一个节点：新 id，同 type / data / 尺寸 / 所属编组（parentId 下 position 是相对
 * 父节点的，直接加偏移就还在组里），位置错开一点。data 深拷贝，两份别共用引用。
 * selected / dragging / measured 这些瞬时状态不抄，副本直接置为选中。
 */
function duplicateCanvasNode(source: Node): Node {
  return {
    id: crypto.randomUUID(),
    type: source.type,
    position: {
      x: source.position.x + DUPLICATE_OFFSET,
      y: source.position.y + DUPLICATE_OFFSET,
    },
    data: copiedNodeData(source.data),
    ...(source.width !== undefined ? { width: source.width } : {}),
    ...(source.height !== undefined ? { height: source.height } : {}),
    ...(source.style ? { style: { ...source.style } } : {}),
    ...(source.parentId ? { parentId: source.parentId, extent: source.extent } : {}),
    selected: true,
  };
}

/** 浮动连线的三次贝塞尔（屏幕坐标），弯度随水平距离走，和 React Flow 默认连线手感一致 */
function floatLinePath({ from, to }: FloatLine): string {
  const bend = Math.max(Math.abs(to.x - from.x) / 2, 40);
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
}

// 必须定义在组件外：每次 render 都新建对象会让 React Flow 反复重建所有节点和连线
const EDGE_TYPES = { default: AnimatedEdge };

// 类型表和 memo 包装都保持稳定，画布更新时只重渲染 props / 订阅真正变化的节点。
const NODE_TYPES = {
  [MEDIA_NODE_TYPE]: memo(MediaNode),
  [GROUP_NODE_TYPE]: memo(GroupNode),
  [IMAGE_GEN_NODE_TYPE]: memo(ImageGenNode),
  [VIDEO_GEN_NODE_TYPE]: memo(VideoGenNode),
  [TEXT_NODE_TYPE]: memo(TextNode),
};

type CanvasEditorProps = {
  project: Project;
  initialNodes: Node[];
  initialEdges: Edge[];
  initialViewport: Viewport;
  initialGraph: ProjectGraph;
  initialVersion: number;
  onRename: (name: string) => Promise<void>;
  waitForMetadata?: () => Promise<void>;
};

export function CanvasEditor({
  project,
  initialNodes,
  initialEdges,
  initialViewport,
  initialGraph,
  initialVersion,
  onRename,
  waitForMetadata,
}: CanvasEditorProps) {
  const agent = useProjectAgent(project.id);
  const [mode, setMode] = useState<CanvasMode>("select");
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { screenToFlowPosition, flowToScreenPosition, getViewport, getIntersectingNodes, fitView } =
    useReactFlow();
  // React Flow 的节点 / 控制条 / 小地图有自己一套 CSS 变量，不吃我们的 .dark，
  // 必须显式把主题传给它的 colorMode，否则暗色下节点是白底白字，完全看不见
  const { resolvedTheme } = useTheme();
  const wrapperRef = useRef<HTMLDivElement>(null);
  // 连续粘贴同一份剪贴板时逐次错开：记住粘了几次，以及粘的是哪一份（换了就归零）
  const pasteCountRef = useRef(0);
  const pasteSourceRef = useRef<string | null>(null);
  // 上传是异步的，回调里不能用闭包捕获的 nodes/edges（可能已经过期好几轮）
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const history = useGraphHistory({ nodes: initialNodes, edges: initialEdges });
  const { commit: commitHistory, replace: replaceHistory } = history;
  const { status, saveNow } = useGraphAutosave({
    projectId: project.id,
    nodes,
    edges,
    getViewport,
    initialGraph,
    initialVersion,
    readGraph: () => toPersistedGraph(nodesRef.current, edgesRef.current, getViewport()),
  });
  const saveProject = useCallback(async () => {
    await waitForMetadata?.();
    return saveNow();
  }, [waitForMetadata, saveNow]);
  const activeProject = useDesktopProject(project.id, project.name, status, saveProject);

  /** 一次完整操作结束，把结果推进历史 */
  const commitNow = useCallback(
    (nextNodes: Node[], nextEdges: Edge[]) => commitHistory({ nodes: nextNodes, edges: nextEdges }),
    [commitHistory],
  );

  const applySnapshot = useCallback(
    (snapshot: { nodes: Node[]; edges: Edge[] } | null) => {
      if (!snapshot) return;
      const restored = {
        nodes: retainGenerationResults(snapshot.nodes, nodesRef.current, agent.getSnapshot().jobs),
        edges: snapshot.edges,
      };
      nodesRef.current = restored.nodes;
      edgesRef.current = restored.edges;
      setNodes(restored.nodes);
      setEdges(restored.edges);
      replaceHistory(restored);
    },
    [setNodes, setEdges, replaceHistory, agent],
  );

  /** 当前视口中心的画布坐标。新节点、上传的文件、跨项目粘贴都落在这儿 */
  const viewportCenter = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return screenToFlowPosition({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  }, [screenToFlowPosition]);

  const agentBinding = useRef<CanvasBinding | null>(null);
  agentBinding.current = {
    read: () => ({
      nodes: nodesRef.current,
      edges: edgesRef.current,
      viewport: getViewport(),
      center: viewportCenter(),
    }),
    apply: (nextNodes, nextEdges, recordHistory) => {
      if (recordHistory) history.replace({ nodes: nodesRef.current, edges: edgesRef.current });
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      if (recordHistory) commitHistory({ nodes: nextNodes, edges: nextEdges });
      else history.replace({ nodes: nextNodes, edges: nextEdges });
    },
    save: saveProject,
    focus: (ids) => {
      void fitView({ nodes: ids.map((id) => ({ id })), duration: 200 });
    },
  };
  useEffect(
    () =>
      agent.bind({
        read: () => {
          if (!agentBinding.current) throw new Error("画布未挂载");
          return agentBinding.current.read();
        },
        apply: (nodes, edges, recordHistory) =>
          agentBinding.current?.apply(nodes, edges, recordHistory),
        save: () => agentBinding.current?.save() ?? Promise.resolve(false),
        focus: (ids) => agentBinding.current?.focus(ids),
      }),
    [agent],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.source === connection.target) return;
      const sourceNode = nodes.find((node) => node.id === connection.source);
      const targetNode = nodes.find((node) => node.id === connection.target);
      if (!sourceNode || !targetNode || !canConnectNodes(sourceNode, targetNode)) return;

      // 新状态必须在 updater 外面算：updater 里做副作用在 StrictMode 下会跑两次，
      // 历史栈会被塞进重复项，表现为「撤销要按两下才动一次」
      let next = addEdge(connection, edges);

      // 批量连线：起手的节点在多选选区里时，选区内其他能连的资源节点一起连到
      // 同一目标（连线约束见 lib/connection.ts）。addEdge 会跳过完全相同的连线。
      const selected = nodes.filter((node) => node.selected);
      if (selected.some((node) => node.id === connection.source)) {
        for (const node of selected) {
          if (node.id === connection.source || node.id === connection.target) continue;
          if (!canConnectNodes(node, targetNode)) continue;
          next = addEdge(
            {
              source: node.id,
              sourceHandle: null,
              target: connection.target,
              targetHandle: connection.targetHandle,
            },
            next,
          );
        }
      }

      setEdges(next);
      commitNow(nodes, next);
    },
    [setEdges, commitNow, nodes, edges],
  );

  /** 生成类节点：默认落在视口中心，也可指定画布坐标（节点选择菜单用） */
  const addGenNode = useCallback(
    (type: string, defaults: Record<string, unknown>, position?: { x: number; y: number }) => {
      const center = viewportCenter();

      // 落点让节点自身居中。文本按自己的宽高算，
      // 其余是内容自适应的生成节点，量不到，用它们的常见尺寸估一个
      const size = INITIAL_SIZES[type] ?? { width: 534, height: 480 };
      const node = buildCanvasNode(
        type,
        defaults,
        position ?? { x: center.x - size.width / 2, y: center.y - size.height / 2 },
      );
      const next: Node[] = [...nodes, node];
      setNodes(next);
      commitNow(next, edges);
      return node;
    },
    [viewportCenter, setNodes, commitNow, nodes, edges],
  );

  const handleAddImageGen = useCallback(
    () =>
      addGenNode(IMAGE_GEN_NODE_TYPE, DEFAULT_IMAGE_GEN_DATA as unknown as Record<string, unknown>),
    [addGenNode],
  );
  const handleAddVideoGen = useCallback(
    () =>
      addGenNode(VIDEO_GEN_NODE_TYPE, DEFAULT_VIDEO_GEN_DATA as unknown as Record<string, unknown>),
    [addGenNode],
  );
  const handleAddText = useCallback(
    () => addGenNode(TEXT_NODE_TYPE, DEFAULT_TEXT_NODE_DATA as unknown as Record<string, unknown>),
    [addGenNode],
  );

  /**
   * 改名由节点内部的信息条发起（双击名称），经 context 传下去。
   * 读 ref 而不是闭包里的 nodes/edges：这个回调会一直挂在 context value 上，
   * 用闭包的话每次画布有任何变动都要重建 value，把所有节点白白重渲一遍。
   */
  const renameNode = useCallback(
    (nodeId: string, label: string) => {
      const next = nodesRef.current.map((item) =>
        item.id === nodeId ? { ...item, data: { ...item.data, label } } : item,
      );
      setNodes(next);
      commitNow(next, edgesRef.current);
    },
    [setNodes, commitNow],
  );

  /** 节点右侧功能面板里的采用 / 废弃：和改名一样从节点内发起、要进历史 */
  const setNodeMark = useCallback(
    (nodeId: string, mark: NodeMark | null) => {
      const next = markNodes(nodesRef.current, [nodeId], mark);
      if (next === nodesRef.current) return;
      setNodes(next);
      commitNow(next, edgesRef.current);
    },
    [setNodes, commitNow],
  );

  // 单击节点才记为 active（框选不触发 onNodeClick），图像生成节点据此决定是否展开菜单
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  /**
   * 节点右侧功能面板里的原样复制：节点本身 + 从上游过来的连线各抄一份接到副本上，
   * 上游节点不动（副本引用的还是同一批素材，prompt 里的 {{text:id}} / {{image:id}}
   * 徽章指向的节点 id 没变，原样就有效，不用重写）。下游连线不抄：副本还没喂给谁。
   * 副本成为唯一选中且 active 的节点，面板和菜单随之挪到副本上。
   */
  const duplicateNode = useCallback(
    (nodeId: string) => {
      const source = nodesRef.current.find((item) => item.id === nodeId);
      if (!source) return;
      const copy = duplicateCanvasNode(source);
      const nextNodes = [
        ...nodesRef.current.map((item) => (item.selected ? { ...item, selected: false } : item)),
        copy,
      ];
      let nextEdges = edgesRef.current;
      for (const edge of edgesRef.current) {
        if (edge.target !== nodeId) continue;
        nextEdges = addEdge(
          {
            source: edge.source,
            sourceHandle: edge.sourceHandle ?? null,
            target: copy.id,
            targetHandle: edge.targetHandle ?? null,
          },
          nextEdges,
        );
      }
      setNodes(nextNodes);
      setEdges(nextEdges);
      commitNow(nextNodes, nextEdges);
      setActiveNodeId(copy.id);
    },
    [setNodes, setEdges, commitNow],
  );

  // 浮动端点 / 单节点端点拖出的连线（屏幕坐标）与节点选择菜单。弹菜单期间连线保持显示
  const [floatLine, setFloatLine] = useState<FloatLine | null>(null);
  const [picker, setPicker] = useState<NodePickerRequest | null>(null);

  // 拖线悬停中的可放置目标。只在目标能接受当前连线时设值，节点据此播动画
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // 左下角缩略图默认关闭，由画布控制条上的开关控制
  const [showMiniMap, setShowMiniMap] = useState(false);

  /** 拖线过程中按悬停位置刷新可放置目标：sources 里至少一个能连才算 */
  const updateDropTarget = useCallback(
    (point: { x: number; y: number }, sources: Node[]) => {
      const flow = screenToFlowPosition(point);
      const target = getIntersectingNodes({ x: flow.x, y: flow.y, width: 1, height: 1 }).find(
        (node) => targetAcceptsOf(node.type) !== null,
      );
      const ok =
        target && sources.some((node) => node.id !== target.id && canConnectNodes(node, target));
      setDropTargetId(ok && target ? target.id : null);
    },
    [screenToFlowPosition, getIntersectingNodes],
  );

  /** 浮动端点拖动中：更新虚线 + 刷新可放置目标 */
  const handleFloatDragLine = useCallback(
    (line: FloatLine) => {
      setFloatLine(line);
      updateDropTarget(
        line.to,
        nodesRef.current.filter((node) => node.selected && sourceResourceOf(node) !== null),
      );
    },
    [updateDropTarget],
  );

  // 普通端点拖线时挂在 window 上的 move 监听，onConnectEnd 时卸掉
  const connectDragCleanupRef = useRef<(() => void) | null>(null);

  /** 选区里能往外连的资源节点（媒体 / 生成结果 / 文本） */
  const selectedResourceIds = useMemo(
    () =>
      nodes
        .filter((node) => node.selected && sourceResourceOf(node) !== null)
        .map((node) => node.id),
    [nodes],
  );

  /** 浮动端点松手：落在能接受的节点上就批量连线，否则原地弹节点选择菜单 */
  const handleFloatingDrop = useCallback(
    (point: { x: number; y: number }) => {
      setDropTargetId(null);
      const flow = screenToFlowPosition(point);
      const sources = nodesRef.current.filter(
        (node) => node.selected && sourceResourceOf(node) !== null,
      );

      const target = getIntersectingNodes({ x: flow.x, y: flow.y, width: 1, height: 1 }).find(
        (node) => targetAcceptsOf(node.type) !== null,
      );
      if (target) {
        const connectable = sources.filter(
          (node) => node.id !== target.id && canConnectNodes(node, target),
        );
        if (connectable.length > 0) {
          let next = edgesRef.current;
          for (const node of connectable) {
            next = addEdge(
              { source: node.id, sourceHandle: null, target: target.id, targetHandle: null },
              next,
            );
          }
          setEdges(next);
          commitNow(nodesRef.current, next);
          setFloatLine(null);
          return;
        }
      }

      // 落在空白或目标不能接受选区资源：弹菜单让用户当场造一个能接的节点
      setPicker({ screen: point, flow, sourceIds: sources.map((node) => node.id) });
    },
    [screenToFlowPosition, getIntersectingNodes, setEdges, commitNow],
  );

  /** 菜单选择：创建对应节点并把能连的源都连过来，整个过程连线不消失 */
  const handlePickerPick = useCallback(
    (type: PickerNodeType) => {
      if (!picker) return;
      const defaults =
        type === IMAGE_GEN_NODE_TYPE
          ? DEFAULT_IMAGE_GEN_DATA
          : type === VIDEO_GEN_NODE_TYPE
            ? DEFAULT_VIDEO_GEN_DATA
            : DEFAULT_TEXT_NODE_DATA;

      const node = buildCanvasNode(
        type,
        defaults as unknown as Record<string, unknown>,
        picker.flow,
      );
      let nextEdges = edgesRef.current;
      const textIds: string[] = [];
      for (const id of picker.sourceIds) {
        const source = nodesRef.current.find((item) => item.id === id);
        if (source && canConnectNodes(source, node)) {
          nextEdges = addEdge(
            { source: id, sourceHandle: null, target: node.id, targetHandle: null },
            nextEdges,
          );
          if (source.type === TEXT_NODE_TYPE) textIds.push(id);
        }
      }

      // 这个节点是「带着连线一起诞生」的，prompt 里的文本徽章必须在这儿就写好：
      // usePromptTokens 的挂载守卫会把首次见到的连线一律当成已同步
      // （那个守卫是为了刷新后不把用户手动删掉的徽章补回来），
      // 交给它去追就永远追不上。目标是文本节点时连不上任何源，textIds 自然是空的。
      if (textIds.length > 0) {
        node.data = { ...node.data, prompt: syncPromptTokens("", textIds, []) };
      }

      const nextNodes = [...nodesRef.current, node];
      setNodes(nextNodes);
      setEdges(nextEdges);
      commitNow(nextNodes, nextEdges);
      setPicker(null);
      setFloatLine(null);
    },
    [picker, setNodes, setEdges, commitNow],
  );

  const handlePickerClose = useCallback(() => {
    setPicker(null);
    setFloatLine(null);
  }, []);

  const selectedIds = useMemo(
    () => nodes.filter((node) => node.selected).map((node) => node.id),
    [nodes],
  );

  const canvasActions = useMemo(
    () => ({
      projectId: project.id,
      renameNode,
      setNodeMark,
      duplicateNode,
      activeNodeId,
      dropTargetId,
    }),
    [project.id, renameNode, setNodeMark, duplicateNode, activeNodeId, dropTargetId],
  );

  /** 排布类操作统一走这里：算出新数组 → setNodes → 整体入历史栈，一次 ⌘Z 全退回 */
  const applyLayout = useCallback(
    (compute: (current: Node[]) => Node[]) => {
      const next = compute(nodesRef.current);
      if (next === nodesRef.current) return;
      setNodes(next);
      commitNow(next, edgesRef.current);
    },
    [setNodes, commitNow],
  );

  /**
   * 排布真正该动的那批：剔掉父节点已被选中的子节点，并且只留同一父级下的。
   * 子节点坐标是相对父节点的，和顶层节点混在一起算包围盒会得到垃圾数字。
   */
  const layoutIds = useMemo(() => sameParentSelection(nodes, selectedIds), [nodes, selectedIds]);

  const handleArrange = useCallback(
    () => applyLayout((current) => arrangeNodes(current, layoutIds)),
    [applyLayout, layoutIds],
  );

  const handleAlign = useCallback(
    (mode: AlignMode) => applyLayout((current) => alignNodes(current, layoutIds, mode)),
    [applyLayout, layoutIds],
  );

  const groupId = useMemo(() => selectedGroupId(nodes, selectedIds), [nodes, selectedIds]);
  const canGroup = useMemo(() => canGroupNodes(nodes, selectedIds), [nodes, selectedIds]);

  const handleGroup = useCallback(
    () => applyLayout((current) => groupNodes(current, selectedIds)),
    [applyLayout, selectedIds],
  );

  const handleUngroup = useCallback(() => {
    if (!groupId) return;
    applyLayout((current) => ungroupNodes(current, groupId));
  }, [applyLayout, groupId]);

  /** 批量下载和批量标记作用的节点：选中的是编组时是组里的成员 —— 编组本身没有文件 */
  const mediaTargetIds = useMemo(
    () => (groupId ? groupChildIds(nodes, groupId) : selectedIds),
    [nodes, selectedIds, groupId],
  );

  const downloadItems = useMemo(
    () => downloadableMedia(nodes, mediaTargetIds),
    [nodes, mediaTargetIds],
  );

  const markCount = useMemo(
    () => markableIds(nodes, mediaTargetIds).length,
    [nodes, mediaTargetIds],
  );

  const marks = useMemo(() => markSummary(nodes), [nodes]);

  /**
   * 左上角计数芯片：选中某一态的全部素材。只改 selected，不进历史
   * （选中态本来就不落盘，见 toPersistedGraph）。顺手清掉 activeNodeId，
   * 否则上一次单击展开的菜单会挂在一堆被批量选中的节点里。
   */
  const handleSelectByMark = useCallback(
    (mark: NodeMark | null) => {
      const ids = new Set(idsByMark(nodesRef.current, mark));
      setNodes(
        nodesRef.current.map((node) =>
          Boolean(node.selected) === ids.has(node.id)
            ? node
            : { ...node, selected: ids.has(node.id) },
        ),
      );
      setActiveNodeId(null);
    },
    [setNodes],
  );

  const handleMark = useCallback(
    (mark: NodeMark | null) => applyLayout((current) => markNodes(current, mediaTargetIds, mark)),
    [applyLayout, mediaTargetIds],
  );

  const handleDownload = useCallback(() => {
    void downloadMedia(downloadItems);
  }, [downloadItems]);

  const handleSpace = useCallback(
    (mode: SpacingMode) => applyLayout((current) => spaceNodes(current, layoutIds, mode)),
    [applyLayout, layoutIds],
  );

  /**
   * 复制：选区打包成载荷写进 localStorage（见 lib/clipboard.ts），
   * 所以切到别的项目、别的标签页都还粘得出来。
   * 顺利时不打扰用户（和以前一样安静），只有失败或有节点被丢掉时才提示。
   */
  const handleCopy = useCallback(() => {
    const selectedIds = nodes.filter((node) => node.selected).map((node) => node.id);
    if (selectedIds.length === 0) return;

    const payload = toClipboardPayload(nodes, edges, selectedIds, {
      projectId: project.id,
      projectName: project.name,
    });
    if (!payload) {
      toast.error("没有可复制的节点", { description: "上传中的素材要等传完才能复制" });
      return;
    }

    const result = writeClipboard(payload);
    if (result === "too-large") {
      toast.error("复制失败", { description: "选中的内容太大，分几批复制试试" });
      return;
    }
    if (result === "unavailable") {
      toast.error("复制失败", { description: "浏览器不允许写入本地存储" });
      return;
    }
    // 数量对不上说明有节点没进剪贴板（上传中的媒体），得说一声，
    // 否则用户会以为复制全了，粘完才发现少东西
    if (payload.nodes.length < selectedIds.length) {
      toast.info(`已复制 ${payload.nodes.length} 个节点`, {
        description: "上传中的素材不会被复制",
      });
    }
  }, [nodes, edges, project.id, project.name]);

  /**
   * 粘贴：读 localStorage 里那份载荷还原成新节点。
   *
   * 落点分两种，因为两种场景要的东西不一样：
   * - **同项目**沿用原坐标 + 40px 错开，连续 ⌘V 逐次递增，副本就落在原件旁边；
   * - **跨项目**落到当前视口中心 —— 目标画布的空白区域和来源坐标毫无关系，
   *   照搬原坐标很可能粘到屏幕外，用户只会以为没粘上。
   */
  const handlePaste = useCallback(() => {
    const payload = readClipboard();
    if (!payload) return;

    const sameProject = payload.sourceProjectId === project.id;
    // 换了一份剪贴板（自己重新复制过，或另一个标签页复制了别的）就把错开次数归零
    const sourceKey = `${payload.sourceProjectId}:${payload.copiedAt}`;
    if (pasteSourceRef.current !== sourceKey) {
      pasteSourceRef.current = sourceKey;
      pasteCountRef.current = 0;
    }
    const step = PASTE_OFFSET * pasteCountRef.current;
    pasteCountRef.current += 1;

    const base = sameProject
      ? { x: PASTE_OFFSET, y: PASTE_OFFSET }
      : offsetToCenter(payload, viewportCenter());
    const { nodes: pastedNodes, edges: pastedEdges } = fromClipboardPayload(payload, {
      x: base.x + step,
      y: base.y + step,
    });

    // 原选区取消选中，让粘贴出来的这批成为新的选区，可以连续 Cmd+V
    const nextNodes = [
      ...nodesRef.current.map((node) => (node.selected ? { ...node, selected: false } : node)),
      ...pastedNodes,
    ];
    const nextEdges = [...edgesRef.current, ...pastedEdges];
    setNodes(nextNodes);
    setEdges(nextEdges);
    commitNow(nextNodes, nextEdges);

    // 跨项目粘贴要说一声来源：节点是从别处搬来的，用户得能确认没粘错东西
    if (!sameProject) {
      toast.success(`已从「${payload.sourceProjectName}」粘贴 ${pastedNodes.length} 个节点`);
    }
  }, [project.id, viewportCenter, setNodes, setEdges, commitNow]);

  /** 上传占位节点入场：一次性放上去并入历史栈 */
  const handleUploadNodesCreated = useCallback(
    (created: Node[]) => {
      const next = [...nodesRef.current, ...created];
      setNodes(next);
      commitNow(next, edgesRef.current);
    },
    [setNodes, commitNow],
  );

  /**
   * 上传完成 / 失败、或量到原始尺寸时回填。
   * 用 setNodes 的函数式写法读最新值：上传异步，回调触发时闭包里的 nodes 早过期了。
   * 这里不入历史栈 —— 回填是上传的结果，不是用户的一次操作，
   * 否则按 Cmd+Z 会把节点退回"上传中"这种没意义的状态。
   */
  const handleUploadNodeSettled = useCallback(
    (nodeId: string, patch: Partial<MediaNodeData>, size?: { width: number; height: number }) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: { ...node.data, ...patch },
                ...(size ? { width: size.width, height: size.height, style: size } : {}),
              }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const startUpload = useMediaUpload({
    projectId: project.id,
    onNodesCreated: handleUploadNodesCreated,
    onNodeSettled: handleUploadNodeSettled,
  });

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;

      event.preventDefault();
      const origin = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      startUpload(files, { x: origin.x - 112, y: origin.y - 80 });
    },
    [screenToFlowPosition, startUpload],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    // 不 preventDefault 的话浏览器会把文件当成导航，整个页面被图片替换掉
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  /** 底部工具条的上传按钮：文件落在当前视口中心 */
  const handlePickFiles = useCallback(
    (files: File[]) => {
      const center = viewportCenter();
      startUpload(files, { x: center.x - 112, y: center.y - 80 });
    },
    [viewportCenter, startUpload],
  );

  const isMove = mode === "move";

  useCanvasShortcuts(
    {
      onUndo: () => applySnapshot(history.undo()),
      onRedo: () => applySnapshot(history.redo()),
      onCopy: handleCopy,
      onPaste: handlePaste,
      onSelectMode: () => setMode("select"),
      onMoveMode: () => setMode("move"),
    },
    activeProject,
  );

  return (
    <TooltipProvider delayDuration={200}>
      <CanvasActionsProvider value={canvasActions}>
        {/* 画布铺满整个视口，所有控件都以浮层叠在上面，最大化可用画布面积 */}
        {/* role=application：这是个有自己快捷键的编辑器，要让屏幕阅读器把按键放行给页面 */}
        <div
          ref={wrapperRef}
          className="h-dvh w-full"
          // 移动模式的光标和选区覆盖层样式挂在 globals.css，按这个属性生效
          data-canvas-mode={mode}
          role="application"
          aria-label="节点画布，可将图片、视频、音频文件拖入此处上传"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            // 拖动过程中会连发几十次 position change，只在拖完才入栈，
            // 否则按一次 Cmd+Z 只会把节点挪回一个像素
            onNodeDragStop={() => commitNow(nodes, edges)}
            onNodesDelete={() => commitNow(nodes, edges)}
            onEdgesDelete={() => commitNow(nodes, edges)}
            onConnectStart={(_, { nodeId, handleType }) => {
              // 普通端点拖线时也做「可放置」高亮：move 里按悬停位置刷新目标
              if (handleType !== "source" || !nodeId) return;
              const fromNode = nodesRef.current.find((node) => node.id === nodeId);
              if (!fromNode) return;
              const handleMove = (move: PointerEvent) =>
                updateDropTarget({ x: move.clientX, y: move.clientY }, [fromNode]);
              window.addEventListener("pointermove", handleMove);
              connectDragCleanupRef.current = () =>
                window.removeEventListener("pointermove", handleMove);
            }}
            onConnectEnd={(event, connectionState) => {
              connectDragCleanupRef.current?.();
              connectDragCleanupRef.current = null;
              setDropTargetId(null);
              // 落在 target 端点上的 React Flow 自己会连，这里不管
              if (connectionState.isValid) return;
              const fromNode = connectionState.fromNode;
              if (!fromNode || connectionState.fromHandle?.type !== "source") return;
              const touch = "changedTouches" in event ? event.changedTouches[0] : event;
              if (!touch) return;
              const point = { x: touch.clientX, y: touch.clientY };
              const flow = screenToFlowPosition(point);
              // 松手在节点身上（没落在 target 端点上）也算连上
              const target = getIntersectingNodes({
                x: flow.x,
                y: flow.y,
                width: 1,
                height: 1,
              }).find((node) => node.id !== fromNode.id && canConnectNodes(fromNode, node));
              if (target) {
                handleConnect({
                  source: fromNode.id,
                  sourceHandle: null,
                  target: target.id,
                  targetHandle: null,
                });
                return;
              }
              // 落在空白或不能接受的节点上：和浮动端点一样，原地弹节点选择菜单。
              // React Flow 自己的连线松手就没了，用浮动连线那条虚线接着画，
              // 起点取 connectionState.from（端点中心，画布坐标）换成屏幕坐标
              if (sourceResourceOf(fromNode) === null) return;
              setFloatLine({ from: flowToScreenPosition(connectionState.from), to: point });
              setPicker({ screen: point, flow, sourceIds: [fromNode.id] });
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault();
              const point = { x: event.clientX, y: event.clientY };
              setPicker({ screen: point, flow: screenToFlowPosition(point), sourceIds: [] });
            }}
            isValidConnection={(connection) => {
              const source = nodesRef.current.find((node) => node.id === connection.source);
              const target = nodesRef.current.find((node) => node.id === connection.target);
              return !!source && !!target && canConnectNodes(source, target);
            }}
            onNodeClick={(_, node) => setActiveNodeId(node.id)}
            onPaneClick={() => setActiveNodeId(null)}
            onSelectionStart={() => setActiveNodeId(null)}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            colorMode={resolvedTheme === "dark" ? "dark" : "light"}
            defaultViewport={initialViewport}
            // 下限对齐控制条里的 10% 档位
            minZoom={0.1}
            maxZoom={2}
            // 右下角的 React Flow 角标不要
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={activeProject ? ["Backspace", "Delete"] : null}
            multiSelectionKeyCode={["Meta", "Shift"]}
            // 选择模式：左键框选，平移让给中键（右键留给节点选择菜单），节点可拖
            // 移动模式：左键平移，节点不可拖（拖节点也是平移），语义对齐 Figma 的抓手
            panOnDrag={isMove ? true : [1]}
            selectionOnDrag={!isMove}
            // 框选碰到节点就算选中，不要求整个框住
            selectionMode={SelectionMode.Partial}
            nodesDraggable={!isMove}
            // 移动模式下必须连 selectable 一起关掉：只关 draggable 的话，
            // 节点本身和多选时那层 nodesselection-rect 仍然吃指针事件，
            // 从节点上起手拖动画布会纹丝不动。关掉后 React Flow 会自己把它们
            // 设成 pointer-events:none，抓手才真的「哪儿都能拖」
            elementsSelectable={!isMove}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />

            <FloatingConnector
              selectedIds={selectedIds}
              visible={!isMove && selectedResourceIds.length >= 2}
              onDragLine={handleFloatDragLine}
              onDrop={handleFloatingDrop}
            />

            <SelectionToolbar
              selectedIds={selectedIds}
              groupId={groupId}
              canGroup={canGroup}
              onGroup={handleGroup}
              onUngroup={handleUngroup}
              onArrange={handleArrange}
              onAlign={handleAlign}
              onSpace={handleSpace}
              onDownload={handleDownload}
              downloadCount={downloadItems.length}
              onMark={handleMark}
              markCount={markCount}
            />

            <Panel position="top-left">
              <CanvasInfoGroup
                project={project}
                nodeCount={nodes.length}
                saveStatus={status}
                onRename={onRename}
                marks={marks}
                onSelectByMark={handleSelectByMark}
              />
            </Panel>

            <Panel position="top-right">
              <CanvasActionGroup projectId={project.id} />
            </Panel>

            <Panel position="bottom-center">
              <NodePalette
                mode={mode}
                onModeChange={setMode}
                onAddImageGen={handleAddImageGen}
                onAddVideoGen={handleAddVideoGen}
                onAddText={handleAddText}
                onPickFiles={handlePickFiles}
                canUndo={history.canUndo}
                canRedo={history.canRedo}
                onUndo={() => applySnapshot(history.undo())}
                onRedo={() => applySnapshot(history.redo())}
              />
            </Panel>

            <Panel position="bottom-left">
              <CanvasControls
                showMiniMap={showMiniMap}
                onToggleMiniMap={() => setShowMiniMap((value) => !value)}
              />
            </Panel>
            {/* marginBottom 抬到控制条上方，两个面板同在左下角 */}
            {showMiniMap && (
              <MiniMap pannable zoomable position="bottom-left" style={{ marginBottom: 56 }} />
            )}
          </ReactFlow>

          {/* 浮动端点拖出的连线。屏幕坐标直接画在画布容器上层，弹菜单期间保持 */}
          {floatLine && (
            <svg
              aria-hidden
              className="pointer-events-none absolute inset-0 z-40 size-full overflow-visible"
            >
              <path
                d={floatLinePath(floatLine)}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={1.6}
                strokeDasharray="6 4"
              />
              <circle cx={floatLine.to.x} cy={floatLine.to.y} r={4} fill="#3b82f6" />
            </svg>
          )}

          {picker && (
            <NodePickerMenu
              request={picker}
              nodes={nodes}
              onPick={handlePickerPick}
              onClose={handlePickerClose}
            />
          )}
        </div>
      </CanvasActionsProvider>
    </TooltipProvider>
  );
}
