import { STAGE_COLORS, STAGE_LABELS, type CandidateStage } from '@/lib/candidates'

export default function StageBadge({ stage }: { stage: CandidateStage }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs
                  font-medium border ${STAGE_COLORS[stage]}`}
    >
      {STAGE_LABELS[stage]}
    </span>
  )
}
