import { useId } from 'react'
import { Trash } from '@phosphor-icons/react'

import {
  BOARD_PROFILES,
  boardGuide,
  type BoardTypeId,
} from '../domain/board'
import { useEditor } from '../editor/store'
import { t } from '../i18n/zh'

const ORDER: BoardTypeId[] = ['mini26', 'mini52', 'mini78', 'mini104', 'midi29']

/** 左侧板库：拖动一个缩小的实体板到画布，落点立即成为一块板。 */
export default function BoardPicker() {
  const placements = useEditor((s) => s.layout.placements)
  const removeBoard = useEditor((s) => s.removeBoard)
  const selectedBoard = useEditor((s) => s.selectedBoard)
  const setSelectedBoard = useEditor((s) => s.setSelectedBoard)
  const copy = t('picker')

  const chooseBoard = (board: BoardTypeId) => {
    setSelectedBoard(board)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-3">
        <div className="flex flex-col gap-3">
          {[2.6, 5].map((pitch) => (
            <section key={pitch}>
              <h3 className="mb-2 text-xs font-medium text-ink-2">
                {pitch === 2.6 ? copy.miniPitch : copy.midiPitch}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {ORDER.filter((id) => BOARD_PROFILES[id].pitchMm === pitch).map((id) => {
                  const profile = BOARD_PROFILES[id]
                  const active = selectedBoard === id
                  return (
                    <button
                      key={id}
                      type="button"
                      draggable
                      aria-pressed={active}
                      aria-label={profile.label}
                      title={profile.label}
                      onClick={() => chooseBoard(id)}
                      onDragStart={(event) => {
                        chooseBoard(id)
                        event.dataTransfer.setData('text/pindou-board', id)
                        event.dataTransfer.effectAllowed = 'copy'
                      }}
                      className={`flex min-w-0 items-center justify-center rounded-xl border p-1 transition-colors ${
                        active ? 'border-accent bg-hover' : 'border-line bg-surface hover:bg-hover'
                      }`}
                    >
                      <BoardThumbnail board={id} size={100} labelPx={12} />
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-4 rounded-lg border border-accent/35 bg-hover/60 p-2.5 text-[11px] leading-4 text-ink-2">
          {copy.dragHint}
        </p>

        <section className="mt-4 border-t border-line pt-3">
          <h3 className="mb-2 text-xs font-medium text-ink-2">
            {placements.length ? copy.placed(placements.length) : copy.emptyHint}
          </h3>
          {placements.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {placements.map((placement, index) => (
                <div key={`${placement.board}-${index}`} className="flex items-center gap-2 rounded-lg bg-workspace p-1.5">
                  <BoardThumbnail board={placement.board} size={42} />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-2">
                    {BOARD_PROFILES[placement.board].pegs} × {BOARD_PROFILES[placement.board].pegs}
                    <span className="block text-[10px] text-ink-2/70">
                      {placement.col}, {placement.row}
                    </span>
                  </span>
                  <button
                    type="button"
                    title={copy.removeThis}
                    aria-label={`${copy.removeThis} ${index + 1}`}
                    onClick={() => removeBoard(index)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-danger"
                  >
                    <Trash size={14} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function BoardThumbnail({
  board,
  size,
  labelPx = 6,
}: {
  board: BoardTypeId
  size: number
  labelPx?: number
}) {
  const pegs = BOARD_PROFILES[board].pegs
  const guide = boardGuide({ board, c0: 0, r0: 0 })
  const patternId = `peg-${useId().replaceAll(':', '')}`
  // 选择卡片空间有限：给大缩略图多留一圈安全边距，让尺寸文字也落在图内。
  const pad = size >= 80 ? 14 : 10
  const view = `${-pad} ${-pad} ${pegs + pad * 2} ${pegs + pad * 2}`
  const guideWidth = Math.max(0.28, pegs / 300)
  const fontSize = labelPx * (pegs + pad * 2) / (size + 18)

  return (
    <svg
      aria-hidden
      width={size + 18}
      height={size + 18}
      viewBox={view}
      className="block h-auto max-w-full shrink-0 overflow-visible"
      shapeRendering="geometricPrecision"
    >
      <defs>
        <pattern id={patternId} width="1" height="1" patternUnits="userSpaceOnUse">
          <circle cx="0.5" cy="0.5" r="0.3" fill="#9aa39d" />
        </pattern>
      </defs>
      <rect x={0} y={0} width={pegs} height={pegs} rx={1.2} fill="#f7f8f6" stroke="#a5aea8" strokeWidth={guideWidth} />
      <rect x={0} y={0} width={pegs} height={pegs} fill={`url(#${patternId})`} />
      {guide && (
        <g fill="none" stroke="#111111" strokeWidth={guideWidth} strokeLinecap="butt">
          {guide.solidCols.map((col) => (
            <line key={`v-${col}`} x1={col} y1={guide.top} x2={col} y2={guide.bottom} />
          ))}
          {guide.solidRows.map((row) => (
            <line key={`h-${row}`} x1={guide.left} y1={row} x2={guide.right} y2={row} />
          ))}
          <g strokeDasharray="1.5 1.5">
            {guide.dashedCols.map((col) => (
              <line key={`dv-${col}`} x1={col} y1={guide.top} x2={col} y2={guide.bottom} />
            ))}
            {guide.dashedRows.map((row) => (
              <line key={`dh-${row}`} x1={guide.left} y1={row} x2={guide.right} y2={row} />
            ))}
          </g>
        </g>
      )}
      <g fill="#4b554f" fontFamily="ui-monospace, Menlo, monospace" fontSize={fontSize} textAnchor="middle">
        <text x={pegs / 2} y={-2}>{pegs}</text>
        <text transform={`translate(${pegs + 5} ${pegs / 2}) rotate(90)`}>{pegs}</text>
      </g>
    </svg>
  )
}
