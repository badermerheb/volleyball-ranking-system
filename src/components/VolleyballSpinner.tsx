// src/components/VolleyballSpinner.tsx
import { motion } from "framer-motion";
import volleyball from "../assets/volleyball.png";

export default function VolleyballSpinner({
  size = 32,
  speed = 1.2,
  label = "Loading…",
}: {
  size?: number;
  speed?: number; // seconds per spin
  label?: string;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <motion.img
        src={volleyball}
        alt={label}
        style={{ width: size, height: size }}
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, ease: "linear", duration: speed }}
      />
      {label && (
        <span className="text-sm text-muted-foreground select-none">{label}</span>
      )}
    </div>
  );
}
