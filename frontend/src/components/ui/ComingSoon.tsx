/**
 * Placeholder for pages that ship in a later milestone.
 * Keeps the app fully navigable from Milestone 1 onward even though
 * most screens aren't built yet — mirrors the same pattern used in the
 * original desktop app's PlaceholderPage.
 */
export default function ComingSoon({ title, milestone }: { title: string; milestone: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl px-16 py-12 text-center">
        <div className="text-4xl mb-4">🚧</div>
        <h2 className="text-xl font-bold text-white mb-1">{title}</h2>
        <p className="text-gray-500 text-sm">Arriving in {milestone}</p>
      </div>
    </div>
  )
}
