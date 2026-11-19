import { useEffect, useRef } from 'react';
import { Renderer, type RenderNode } from '@/lib/webgl/renderer';

interface Props {
  nodes: RenderNode[];
  height?: number | string;
  onReady?: (renderer: Renderer) => void;
}

/** WebGL2 画布：自动渲染循环 + 轨道相机控制 */
export function WebGLCanvas({ nodes, height = 480, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: Renderer;
    try {
      renderer = new Renderer(canvas);
    } catch (e) {
      console.error(e);
      return;
    }
    rendererRef.current = renderer;
    onReady?.(renderer);
    const detach = renderer.attachControls(canvas);
    let raf = 0;
    const loop = () => {
      renderer.setNodes(nodesRef.current);
      renderer.render();
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelAnimationFrame(raf); detach(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height, display: 'block', borderRadius: 8, background: '#1a1d24', touchAction: 'none' }}
    />
  );
}
