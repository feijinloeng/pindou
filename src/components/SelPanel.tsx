import { useEditor } from '../editor/store'
import { t } from '../i18n/zh'
import { Btn, Label, Panel } from './ui'

export default function SelPanel() {
  const selection = useEditor((s) => s.selection)
  const clipboard = useEditor((s) => s.clipboard)
  const colorIndex = useEditor((s) => s.colorIndex)
  const bench = useEditor((s) => s.bench)
  const benchRunning = useEditor((s) => s.benchRunning)
  const grid = useEditor((s) => s.grid)
  const boards = useEditor((s) => s.geom.boards.length)
  const undoBytes = useEditor((s) => s.undoBytes)

  // 动作是稳定引用，不需要订阅（订阅了反而每笔拖拽都重渲染整个面板）
  const a = useEditor.getState()
  const hasSel = selection.length > 0
  const selLabel = hasSel ? `${selection.length} 个矩形` : '无'

  return (
    <>

      <Panel title={`${t('editor').selection}（${selLabel}）`}>
        <div className="grid grid-cols-2 gap-1">
          <Btn onClick={a.selectAll}>全选</Btn>
          <Btn onClick={a.clearSel} disabled={!hasSel}>
            取消选区
          </Btn>
          <Btn onClick={a.invertSel} disabled={selection.length !== 1}>
            反选
          </Btn>
          <Btn onClick={a.copySel} disabled={!hasSel}>
            {t('editor').copy}
          </Btn>
          <Btn onClick={a.cutSel} disabled={!hasSel}>
            {t('editor').cut}
          </Btn>
          <Btn onClick={a.pasteSel} disabled={!clipboard}>
            {t('editor').paste}
          </Btn>
          <Btn onClick={() => a.fillSel(colorIndex)} disabled={!hasSel}>
            {t('editor').fill}
          </Btn>
          <Btn onClick={a.eraseSel} disabled={!hasSel}>
            {t('editor').erase}
          </Btn>
        </div>
      </Panel>

      <Panel title="变换">
        <div className="grid grid-cols-2 gap-1">
          <Btn onClick={() => a.mirror('h')}>{t('editor').mirrorH}</Btn>
          <Btn onClick={() => a.mirror('v')}>{t('editor').mirrorV}</Btn>
          <Btn onClick={() => a.rotate(1)}>{t('editor').rotateCw}</Btn>
          <Btn onClick={() => a.rotate(-1)}>{t('editor').rotateCcw}</Btn>
        </div>
        <div className="grid grid-cols-4 gap-1">
          <Btn onClick={() => a.translate(-1, 0)} title="整图左移一格">
            ←
          </Btn>
          <Btn onClick={() => a.translate(1, 0)} title="整图右移一格">
            →
          </Btn>
          <Btn onClick={() => a.translate(0, -1)} title="整图上移一格">
            ↑
          </Btn>
          <Btn onClick={() => a.translate(0, 1)} title="整图下移一格">
            ↓
          </Btn>
        </div>
        <p className="text-[11px] leading-relaxed text-neutral-500">
          镜像和旋转作用在选区上（没选区就是整图）。旋转要求正方形区域。平移永远作用于整图。
        </p>
      </Panel>

      <Panel title="性能自测">
        <Btn onClick={a.runBench} disabled={benchRunning}>
          {benchRunning ? t('editor').benchRunning : t('editor').bench}
        </Btn>
        {bench?.map((phase) => (
          <div key={phase.label} className="rounded bg-neutral-50 p-2 text-[11px]">
            <div className="text-neutral-700">{phase.label}</div>
            <div className="tabular-nums text-neutral-500">
              {phase.visibleCells.toLocaleString()} 格/屏 · 重绘 {phase.avgDrawMs}ms（最差{' '}
              {phase.worstDrawMs}ms）· ≈{phase.fps} fps
            </div>
          </div>
        ))}
      </Panel>

      <Panel title="统计">
        <Label value={grid.cols * grid.rows}>{t('editor').cells}</Label>
        <Label value={`${boards} 块板`}>{t('editor').boards}</Label>
        <Label value={`${(undoBytes / 1024 / 1024).toFixed(2)} MB`}>{t('editor').undoMemory}</Label>
        <p className="text-[11px] leading-relaxed text-neutral-500">{t('editor').hint}</p>
      </Panel>
    </>
  )
}
