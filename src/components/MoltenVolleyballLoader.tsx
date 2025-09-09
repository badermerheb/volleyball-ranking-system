import { motion } from "framer-motion";

export default function MoltenVolleyballLoader({
  size = 72,
  speed = 1.2,
  label = "Loading…",
}: {
  size?: number;
  speed?: number; // seconds per full spin
  label?: string;
}) {
  const s = size;

  return (
    <div className="inline-flex items-center gap-3">
      {/* glow */}
      <div
        className="absolute blur-xl rounded-full opacity-50"
        style={{
          width: s * 0.9,
          height: s * 0.9,
          background:
            "radial-gradient(closest-side, rgba(255,170,0,0.35), rgba(255,80,0,0.15), transparent 70%)",
        }}
      />
      {/* ball */}
      <motion.svg
        width={s}
        height={s}
        viewBox="0 0 100 100"
        aria-label={label}
        role="img"
        className="relative drop-shadow-[0_4px_12px_rgba(255,140,0,0.35)]"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, ease: "linear", duration: speed }}
      >
        <defs>
          {/* molten noise warping */}
          <filter id="molten">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="2"
              seed="7"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="3.5"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>

          {/* hot gradient */}
          <radialGradient id="lava" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#FFE08A" />
            <stop offset="40%" stopColor="#FFB347" />
            <stop offset="75%" stopColor="#FF7A00" />
            <stop offset="100%" stopColor="#B43E00" />
          </radialGradient>

          {/* seam stroke style */}
          <style>{`
            .seam { stroke: #fff; stroke-width: 4; stroke-linecap: round; opacity: .95 }
            .seamLite { stroke: rgba(255,255,255,.75); stroke-width: 3; stroke-linecap: round }
          `}</style>
        </defs>

        {/* ball body */}
        <g filter="url(#molten)">
          <circle cx="50" cy="50" r="45" fill="url(#lava)" />
        </g>

        {/* volleyball seams */}
        <g>
          {/* main curved bands */}
          <path className="seam" fill="none" d="M12 50c18-20 58-20 76 0" />
          <path className="seam" fill="none" d="M12 50c18 20 58 20 76 0" />
          {/* vertical-ish bands */}
          <path className="seamLite" fill="none" d="M50 5c-14 16-14 74 0 90" />
          <path className="seamLite" fill="none" d="M30 12c-8 14-8 60 0 76" />
          <path className="seamLite" fill="none" d="M70 12c8 14 8 60 0 76" />
        </g>

        {/* specular highlight */}
        <ellipse
          cx="38"
          cy="30"
          rx="14"
          ry="10"
          fill="white"
          opacity="0.25"
          transform="rotate(-20 38 30)"
        />
      </motion.svg>

      <span className="text-sm text-muted-foreground select-none">{label}</span>
    </div>
  );
}
