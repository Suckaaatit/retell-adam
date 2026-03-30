import { cn } from "@/lib/utils";

type GodsCrewLogoProps = {
  className?: string;
  size?: number;
  withGlow?: boolean;
};

export function GodsCrewLogo({ className, size = 34, withGlow = false }: GodsCrewLogoProps) {
  const ringGradientId = "gc-ring-gradient";
  const centerGradientId = "gc-center-gradient";
  const glossGradientId = "gc-gloss-gradient";

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center rounded-xl",
        withGlow && "shadow-[0_0_28px_rgba(56,182,255,0.45)]",
        className
      )}
      style={{ height: size, width: size }}
    >
      <svg fill="none" viewBox="0 0 640 640" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={ringGradientId} x1="86" x2="550" y1="510" y2="108">
            <stop stopColor="#47D6FF" />
            <stop offset="0.45" stopColor="#1D9ADD" />
            <stop offset="1" stopColor="#0A67C9" />
          </linearGradient>
          <linearGradient id={centerGradientId} x1="242" x2="496" y1="322" y2="322">
            <stop stopColor="#57D9FF" />
            <stop offset="1" stopColor="#0A72CF" />
          </linearGradient>
          <linearGradient id={glossGradientId} x1="112" x2="268" y1="290" y2="170">
            <stop stopColor="rgba(255,255,255,0.34)" />
            <stop offset="1" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>

        <path
          clipRule="evenodd"
          d="M320 42 584 278 320 596 56 278 320 42ZM320 130 490 278 320 502 150 278 320 130Z"
          fill={`url(#${ringGradientId})`}
          fillRule="evenodd"
        />

        <path
          d="M56 278 320 596 150 278 206 160 56 278Z"
          fill="rgba(86,226,255,0.26)"
        />
        <path
          d="M206 160 434 160 584 278 490 278 206 160Z"
          fill="rgba(255,255,255,0.14)"
        />
        <path
          d="M320 502 490 278 584 278 320 596 320 502Z"
          fill="rgba(3,50,112,0.44)"
        />
        <path
          d="M240 256H538L500 322H304L240 256Z"
          fill={`url(#${centerGradientId})`}
        />
        <path
          d="M128 278 198 196H252L206 238H508L540 196H542L508 238H252L206 284H508L470 324H304L356 392 286 470 128 278Z"
          fill="#FFFFFF"
        />
        <path
          d="M118 284 206 160 252 160 198 196 128 278 118 284Z"
          fill={`url(#${glossGradientId})`}
          opacity="0.45"
        />
      </svg>
    </div>
  );
}
