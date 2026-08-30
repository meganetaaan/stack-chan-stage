import { useEffect, useRef, useState } from "react";

import type { StageWebApplication } from "../../composition/application";
import { SimulatorEngine } from "../../../../../vendor/stack-chan-simulator/web/src/services/simulator/simulator-engine.mjs";
import { createMemoryModStorage } from "../../../../../vendor/stack-chan-simulator/web/simulator/mod-storage.mjs";

export type SimulatorPhase = "loading" | "ready" | "error";

export const SimulatorView = ({
  application,
  onPhaseChange,
}: Readonly<{
  application: StageWebApplication;
  onPhaseChange?: (phase: SimulatorPhase) => void;
}>) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLCanvasElement>(null);
  const screenRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<SimulatorPhase>("loading");

  useEffect(() => {
    const stage = stageRef.current;
    const viewport = viewportRef.current;
    const screen = screenRef.current;
    if (!stage || !viewport || !screen) return;
    const detachStage = application.attachStageRoot(stage);
    const controller = new AbortController();
    let engine: SimulatorEngine | undefined;
    const update = (next: SimulatorPhase) => {
      if (controller.signal.aborted) return;
      setPhase(next);
      onPhaseChange?.(next);
      application.setSimulatorAvailability(
        next === "ready" ? "online" : "offline",
      );
    };
    update("loading");

    void (async () => {
      try {
        const response = await fetch("/simulator/stage-client.xsa", {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`Stage MOD failed with HTTP ${response.status}`);
        const storage = createMemoryModStorage();
        await storage.saveInstalledMod({
          name: "stackchan-stage-client.xsa",
          bytes: new Uint8Array(await response.arrayBuffer()),
        });
        if (controller.signal.aborted) return;
        engine = new SimulatorEngine({
          viewport,
          screen,
          runtimeBaseUrl: new URL("simulator/", document.baseURI).href,
          modStorage: storage,
          hostStage: application.stageBridge,
          onReady: () => update("ready"),
          onError: (error) => {
            console.error("[simulator] startup failed", error);
            update("error");
          },
        });
        await engine.start();
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("[simulator] initialization failed", error);
        update("error");
      }
    })();

    return () => {
      controller.abort();
      engine?.dispose();
      detachStage();
      application.setSimulatorAvailability("offline");
    };
  }, [application, onPhaseChange]);

  return (
    <div
      className="simulator-stage"
      ref={stageRef}
      data-simulator-phase={phase}
    >
      <canvas
        ref={viewportRef}
        className="simulator-viewport"
        aria-label="Stack-chan 3Dシミュレータ"
      />
      <canvas
        ref={screenRef}
        className="simulator-screen-source"
        width="320"
        height="240"
        aria-hidden="true"
      />
      {phase !== "ready" && (
        <div
          className="simulator-state"
          role={phase === "error" ? "alert" : "status"}
        >
          <span className="simulator-state-dot" />
          {phase === "error"
            ? "Simulatorを起動できません"
            : "Simulatorを準備中"}
        </div>
      )}
    </div>
  );
};
