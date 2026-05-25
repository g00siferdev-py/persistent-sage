import { useEffect, useState } from "react";

/** Branded splash while the main UI loads (see `nova_lib::run` splash timing). */
export function SplashScreen() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center bg-[#050a14]">
      <div
        className={`flex max-w-[min(100%,28rem)] flex-col items-center px-4 transition-opacity duration-500 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      >
        <img
          src="/persistent-sage-splash.png"
          alt="Persistent Sage — AI companion"
          className="w-full object-contain drop-shadow-[0_0_24px_rgba(34,211,238,0.25)]"
        />
      </div>
    </div>
  );
}
