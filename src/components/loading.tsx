"use client"

interface LoadingProps {
  modelLoaded: boolean
  mediaPipeReady: boolean
}

export default function Loading({ modelLoaded, mediaPipeReady }: LoadingProps) {
  if (modelLoaded && mediaPipeReady) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-6 pointer-events-none">
      <div className="text-sm font-medium flex items-baseline rounded-full border border-white/15 bg-black/60 px-5 py-2.5 text-white shadow-2xl backdrop-blur-md">
        <span>Loading MediaPipe vision model and MMD character</span>
        <Dot delay="0s" />
        <Dot delay="0.2s" />
        <Dot delay="0.4s" />
      </div>
    </div>
  )
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block"
      style={{
        animation: `loading-dot 1.4s ease-in-out infinite`,
        animationDelay: delay,
        willChange: "opacity",
      }}
    >
      .
    </span>
  )
}
