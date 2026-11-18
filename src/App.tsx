import { useEffect, useRef, useState } from "react";
import Training from "./game/Training";
import Planning from "./game/Planning";
import Scene, { type SceneReplay } from "./game/Scene";
import { DaySummary, FinalReport } from "./game/Summary";
import {
  decisionFromPlan,
  planFromMachine,
  type Plan,
} from "./game/plan";
import type { ChartPoint } from "./ui/Chart";
import { decodeAction, getActionContext, type RLAction } from "./rl/action";
import type { TrainProgress } from "./rl/algos/ppo";
import { encodeObservation } from "./rl/env";
import type {
  WorkerDoneResult,
  WorkerRequest,
  WorkerResponse,
  WorkerTrainConfig,
} from "./rl/protocol";
import TrainerWorker from "./rl/trainer.worker?worker&inline";
import {
  clearSavedPolicies,
  listSavedPolicies,
  loadSavedPolicy,
  savePolicy,
  type SavedPolicySummary,
} from "./rl/policyStore";
import type { PolicyMetadata } from "./rl/policyMetadata";
import { CONFIG } from "./sim/config";
import type { DayStats } from "./sim/day";
import {
  createGame,
  currentWholesale,
  stepGame,
  type GameState,
} from "./sim/game";
import { chooseHeuristic } from "./sim/heuristics";
import { applyDecision, type Decision } from "./sim/machine";

type Screen = "home" | "training" | "planning" | "replay" | "summary" | "final";
type TrainingStatus = "idle" | "running" | "paused" | "done";

const EMPTY_PLAN: Plan = Array.from({ length: CONFIG.SLOTS }, () => null);

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

const BUNDLED_POLICY_ID = "__bundled_ppo__";

function fastConfig(policyName: string): WorkerTrainConfig {
  return {
    iterations: 60,
    envs: 16,
    lr: 3e-4,
    gamma: 0.99,
    gaeLambda: 0.95,
    clip: 0.2,
    epochs: 2,
    minibatch: 128,
    entropyCoef: 0.005,
    valueCoef: 0.5,
    seed: 7,
    evalEvery: 10,
    evalSeeds: 16,
    bcEpisodes: 100,
    bcEpochs: 3,
    policyName,
  };
}

function standardConfig(policyName: string): WorkerTrainConfig {
  return {
    ...fastConfig(policyName),
    iterations: 120,
    epochs: 3,
    bcEpisodes: 200,
    bcEpochs: 6,
  };
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [workerReady, setWorkerReady] = useState(false);
  const [hasModel, setHasModel] = useState(false);
  const [savedPolicies, setSavedPolicies] = useState<SavedPolicySummary[]>([]);
  const [policiesLoaded, setPoliciesLoaded] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState(BUNDLED_POLICY_ID);
  const [activePolicy, setActivePolicy] = useState(BUNDLED_POLICY_ID);
  const [policyMetadata, setPolicyMetadata] = useState<PolicyMetadata | null>(null);
  const [loadingPolicy, setLoadingPolicy] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState<TrainingStatus>("idle");
  const [progress, setProgress] = useState<TrainProgress | null>(null);
  const [bc, setBc] = useState<{ epoch: number; loss: number } | null>(null);
  const [trainResult, setTrainResult] = useState<WorkerDoneResult | null>(null);
  const [evalPoints, setEvalPoints] = useState<ChartPoint[]>([]);
  const [trainPoints, setTrainPoints] = useState<ChartPoint[]>([]);
  const [greedy, setGreedy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [humanGame, setHumanGame] = useState<GameState | null>(null);
  const [agentGame, setAgentGame] = useState<GameState | null>(null);
  const [seed, setSeed] = useState<number | null>(null);
  const [plan, setPlan] = useState<Plan>(EMPTY_PLAN);
  const [warehouseBuys, setWarehouseBuys] = useState<Record<string, number>>({});
  const [agentThinking, setAgentThinking] = useState(false);
  const [agentDecision, setAgentDecision] = useState<Decision | null>(null);
  const [humanDecision, setHumanDecision] = useState<Decision | null>(null);
  const [humanStats, setHumanStats] = useState<DayStats | null>(null);
  const [agentStats, setAgentStats] = useState<DayStats | null>(null);
  const [replay, setReplay] = useState<SceneReplay | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(1);

  const workerRef = useRef<Worker | null>(null);
  const trainingStatusRef = useRef<TrainingStatus>("idle");
  const pendingRef = useRef<{
    resolve: (action: RLAction | null) => void;
    timer: number;
  } | null>(null);

  function updateTrainingStatus(status: TrainingStatus): void {
    trainingStatusRef.current = status;
    setTrainingStatus(status);
  }

  useEffect(() => {
    const worker = new TrainerWorker();
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "ready") {
        setWorkerReady(true);
        setHasModel(message.hasModel);
        if (message.hasModel) {
          setActivePolicy(BUNDLED_POLICY_ID);
          setSelectedPolicy(BUNDLED_POLICY_ID);
          setPolicyMetadata(message.metadata ?? null);
        }
      } else if (message.type === "progress") {
        const next = message.progress;
        setProgress(next);
        setGreedy(next.greedyProfit);
        if (next.phase === "ppo") {
          setTrainPoints((points) => [...points, { x: next.iteration, y: next.trainProfit }]);
        }
        if (next.evalProfit !== null) {
          setEvalPoints((points) => [
            ...points,
            { x: next.iteration, y: next.evalProfit as number },
          ]);
        }
      } else if (message.type === "bc") {
        setBc({ epoch: message.epoch, loss: message.loss });
      } else if (message.type === "done") {
        updateTrainingStatus("done");
        setTrainResult(message.result);
        setHasModel(true);
        setActivePolicy(message.result.policyName);
        setSelectedPolicy(message.result.policyName);
        setPolicyMetadata(message.result.policy.metadata ?? null);
        void savePolicy(message.result.policyName, message.result.policy)
          .then(async () => setSavedPolicies(await listSavedPolicies()))
          .catch((saveError: unknown) =>
            setError(`Agent is trained but could not be saved locally: ${saveError}`)
          );
      } else if (message.type === "policy-loaded") {
        setActivePolicy(
          message.name === "Bundled PPO" ? BUNDLED_POLICY_ID : message.name
        );
        setPolicyMetadata(message.metadata ?? null);
        setHasModel(true);
        setLoadingPolicy(false);
      } else if (message.type === "decision") {
        const pending = pendingRef.current;
        if (pending) {
          window.clearTimeout(pending.timer);
          pendingRef.current = null;
          pending.resolve(message.action);
        }
      } else if (message.type === "paused") {
        updateTrainingStatus("paused");
      } else if (message.type === "resumed") {
        updateTrainingStatus("running");
      } else if (message.type === "error") {
        setError(message.message);
        setLoadingPolicy(false);
        if (
          trainingStatusRef.current === "running" ||
          trainingStatusRef.current === "paused"
        ) {
          updateTrainingStatus("idle");
        }
      }
    };
    return () => {
      if (pendingRef.current) {
        window.clearTimeout(pendingRef.current.timer);
        pendingRef.current.resolve(null);
        pendingRef.current = null;
      }
      worker.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void listSavedPolicies()
      .then(setSavedPolicies)
      .catch((storageError: unknown) =>
        setError(`Could not read saved agents: ${storageError}`)
      )
      .finally(() => setPoliciesLoaded(true));
  }, []);

  function requestAgentDecision(game: GameState): Promise<RLAction | null> {
    if (!workerReady || !hasModel || !workerRef.current) {
      return Promise.resolve(null);
    }
    if (pendingRef.current) {
      window.clearTimeout(pendingRef.current.timer);
      pendingRef.current.resolve(null);
      pendingRef.current = null;
    }
    const observation = encodeObservation(
      game,
      game.history[game.history.length - 1] ?? null
    );
    const context = getActionContext(game.machine);
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        if (pendingRef.current?.resolve === resolve) {
          pendingRef.current = null;
          resolve(null);
        }
      }, 5000);
      pendingRef.current = { resolve, timer };
      const request: WorkerRequest = {
        type: "decide",
        obs: observation,
        existing: context.existing,
        freeSlots: context.freeSlots,
      };
      workerRef.current?.postMessage(request);
    });
  }

  function beginGame(gameSeed: number): void {
    const human = createGame(gameSeed);
    const agent = createGame(gameSeed);
    setSeed(gameSeed);
    setHumanGame(human);
    setAgentGame(agent);
    setHumanStats(null);
    setAgentStats(null);
    setHumanDecision(null);
    setAgentDecision(null);
    setReplay(null);
    setWarehouseBuys({});
    setPlan(planFromMachine(human.machine, currentWholesale(human)));
    setScreen("planning");
    setAgentThinking(true);
    void requestAgentDecision(agent).then((action) => {
      if (action) {
        setAgentDecision(
          decodeAction(agent.machine, action, currentWholesale(agent))
        );
      } else {
        setAgentDecision(chooseHeuristic("greedy", agent));
      }
      setAgentThinking(false);
    });
  }

  function nextDay(): void {
    if (!humanGame || !agentGame) return;
    const agent = agentGame;
    setHumanStats(null);
    setAgentStats(null);
    setHumanDecision(null);
    setAgentDecision(null);
    setWarehouseBuys({});
    setPlan(planFromMachine(humanGame.machine, currentWholesale(humanGame)));
    setScreen("planning");
    setAgentThinking(true);
    void requestAgentDecision(agent).then((action) => {
      if (action) {
        setAgentDecision(
          decodeAction(agent.machine, action, currentWholesale(agent))
        );
      } else {
        setAgentDecision(chooseHeuristic("greedy", agent));
      }
      setAgentThinking(false);
    });
  }

  function lockIn(): void {
    if (!humanGame || !agentGame || agentThinking) return;
    const humanPlan = decisionFromPlan(plan, warehouseBuys, humanGame.machine);
    const agentPlan = agentDecision ?? chooseHeuristic("greedy", agentGame);
    const humanStart = applyDecision(
      humanGame.machine,
      humanPlan,
      currentWholesale(humanGame)
    );
    const agentStart = applyDecision(
      agentGame.machine,
      agentPlan,
      currentWholesale(agentGame)
    );
    const humanSlotsBefore = humanStart.machine.slots.map((slot) => ({
      ...slot,
    }));
    const agentSlotsBefore = agentStart.machine.slots.map((slot) => ({
      ...slot,
    }));
    const humanStep = stepGame(humanGame, humanPlan);
    const agentStep = stepGame(agentGame, agentPlan);
    setHumanGame(humanStep.game);
    setAgentGame(agentStep.game);
    setHumanDecision(humanPlan);
    setAgentDecision(agentPlan);
    setHumanStats(humanStep.result.stats);
    setAgentStats(agentStep.result.stats);
    setWarehouseBuys({});
    const events = humanStep.result.log.map((human, index) => ({
      human,
      agent: agentStep.result.log[index] ?? human,
    }));
    setReplay({
      key: Date.now() + humanStep.result.stats.day,
      day: humanStep.result.stats.day,
      events,
      humanSlots: humanSlotsBefore,
      agentSlots: agentSlotsBefore,
    });
    setReplaySpeed(1);
    setScreen("replay");
  }

  function finishReplay(): void {
    setReplay(null);
    setScreen("summary");
  }

  async function loadSelectedPolicy(): Promise<void> {
    if (
      !workerReady ||
      !workerRef.current ||
      trainingStatus === "running" ||
      trainingStatus === "paused"
    ) {
      return;
    }
    setLoadingPolicy(true);
    setError(null);
    if (selectedPolicy === BUNDLED_POLICY_ID) {
      workerRef.current.postMessage({ type: "load-pretrained" } satisfies WorkerRequest);
      return;
    }
    try {
      const policy = await loadSavedPolicy(selectedPolicy);
      if (!policy) throw new Error("That saved model no longer exists");
      workerRef.current.postMessage({
        type: "load-policy",
        name: selectedPolicy,
        policy,
      } satisfies WorkerRequest);
    } catch (loadError) {
      setLoadingPolicy(false);
      setError(`Could not load saved agent: ${loadError}`);
    }
  }

  async function clearSavedModels(): Promise<void> {
    if (
      !workerReady ||
      savedPolicies.length === 0 ||
      trainingStatus === "running" ||
      trainingStatus === "paused" ||
      !window.confirm("Clear saved trained agents? The bundled pretrained PPO stays available.")
    ) {
      return;
    }
    setLoadingPolicy(true);
    setError(null);
    try {
      await clearSavedPolicies();
      setSavedPolicies([]);
      setSelectedPolicy(BUNDLED_POLICY_ID);
      workerRef.current?.postMessage({ type: "load-pretrained" } satisfies WorkerRequest);
    } catch (clearError) {
      setLoadingPolicy(false);
      setError(`Could not clear saved agents: ${clearError}`);
    }
  }

  function startTraining(preset: "fast" | "standard", policyName: string): void {
    if (!workerReady || !policiesLoaded) {
      setError("The agent or saved-model list is still loading. Try again shortly.");
      return;
    }
    const name = policyName.trim();
    if (
      !name ||
      name.length > 40 ||
      name.toLowerCase() === "bundled ppo" ||
      name.toLowerCase() === BUNDLED_POLICY_ID
    ) {
      setError("Use a saved-agent name from 1 to 40 characters other than Bundled PPO.");
      return;
    }
    if (savedPolicies.some((policy) => policy.name === name)) {
      setError("That agent name already exists. Choose a new name to keep both policies.");
      return;
    }
    updateTrainingStatus("running");
    setProgress(null);
    setBc(null);
    setTrainResult(null);
    setEvalPoints([]);
    setTrainPoints([]);
    setGreedy(null);
    setError(null);
    const request: WorkerRequest = {
      type: "train",
      config:
        preset === "fast"
          ? fastConfig(name)
          : standardConfig(name),
    };
    workerRef.current?.postMessage(request);
  }

  const trainingActive =
    trainingStatus === "running" || trainingStatus === "paused";
  const canPlay = workerReady && hasModel && !trainingActive && !loadingPolicy;
  const savedNames = new Set(savedPolicies.map((policy) => policy.name));
  let suggestedNumber = savedPolicies.length + 1;
  while (savedNames.has(`PPO run ${suggestedNumber}`)) suggestedNumber++;
  const suggestedPolicyName = `PPO run ${suggestedNumber}`;
  const evaluationMean =
    policyMetadata?.evaluation.heldOutMeanProfit ??
    policyMetadata?.evaluation.fixedEvaluationMeanProfit;
  const evaluationGames =
    policyMetadata?.evaluation.heldOutSimulations ??
    policyMetadata?.evaluation.fixedEvaluationSimulations;
  const greedyMean = policyMetadata?.evaluation.greedyExpertMeanProfit;

  return (
    <>
      <Scene
        humanSlots={
          screen === "replay" && replay
            ? replay.humanSlots
            : humanGame?.machine.slots ?? null
        }
        agentSlots={
          screen === "replay" && replay
            ? replay.agentSlots
            : agentGame?.machine.slots ?? null
        }
        replay={replay}
        replaySpeed={replaySpeed}
        onReplayDone={finishReplay}
      />

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button className="ghost" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {screen === "home" && (
        <div className="screen centered">
          <div className="panel home-card">
            <span className="eyebrow">
              15 days · two machines · one customer stream
            </span>
            <h1>Vending Wars</h1>
            <p className="lead">
              You run one vending machine. A trained RL agent runs the other.
              Choose 12 items, buy stock, set prices, and try to out-earn it
              over 15 days.
            </p>
            <div className="policy-picker">
              <label>
                <span className="sub">Opponent model</span>
                <select
                  value={selectedPolicy}
                  onChange={(event) => setSelectedPolicy(event.target.value)}
                  disabled={!workerReady || trainingActive || loadingPolicy}
                >
                  <option value={BUNDLED_POLICY_ID}>Bundled PPO</option>
                  {savedPolicies.map((policy) => (
                    <option key={policy.name} value={policy.name}>
                      {policy.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="ghost"
                onClick={() => void loadSelectedPolicy()}
                disabled={
                  !workerReady ||
                  loadingPolicy ||
                  trainingActive ||
                  selectedPolicy === activePolicy
                }
              >
                {loadingPolicy ? "Loading..." : "Load selected"}
              </button>
              <button
                className="ghost"
                onClick={() => void clearSavedModels()}
                disabled={!workerReady || savedPolicies.length === 0 || trainingActive || loadingPolicy}
                title="Deletes locally saved trained agents; keeps bundled PPO."
              >
                Clear saved (keep bundled)
              </button>
            </div>
            <p className="sub policy-status">
              Active agent: {activePolicy === BUNDLED_POLICY_ID ? "Bundled PPO" : activePolicy}
              {loadingPolicy ? " · loading selection" : ""}
            </p>
            {policyMetadata && (
              <p className="sub policy-status">
                Trained with {policyMetadata.training.expertGames ?? "—"} expert games +{" "}
                {policyMetadata.training.ppoIterations ?? "—"} PPO updates.
                {typeof evaluationMean === "number" && typeof greedyMean === "number"
                  ? ` Evaluation (${evaluationGames} simulations): $${evaluationMean.toFixed(2)} vs greedy $${greedyMean.toFixed(2)}.`
                  : ""}
              </p>
            )}
            <div className="button-row">
              <button
                className="primary"
                disabled={!canPlay}
                onClick={() => beginGame(randomSeed())}
              >
                Play vs selected agent
              </button>
              <button
                className="ghost"
                onClick={() => setScreen("training")}
              >
                {trainingActive ? "View training" : "Train your own"}
              </button>
            </div>
            <p className="sub">
              {!workerReady
                ? "Loading the agent worker..."
                : trainingActive
                  ? "Training is running. Pause or stop it to play the new agent."
                  : !hasModel
                    ? "The pretrained agent could not load. Train a new PPO agent below."
                    : "The opponent is a small neural policy trained in your browser with PPO, not an LLM. Custom saved agents are stored only in this browser."}
            </p>
            <div className="home-points">
              <div>
                <strong>Same luck</strong>
                <span>Both machines face the same customers and prices.</span>
              </div>
              <div>
                <strong>Real trade-offs</strong>
                <span>
                  Popular cheap items, niche premiums, volatile wholesale, and
                  leftover salvage.
                </span>
              </div>
              <div>
                <strong>Train or skip</strong>
                <span>
                  Use the bundled agent or train a fresh PPO policy.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {screen === "training" && (
        <Training
          status={trainingStatus}
          progress={progress}
          bc={bc}
          result={trainResult}
          evalPoints={evalPoints}
          trainPoints={trainPoints}
          greedy={greedy}
          hasModel={hasModel}
          ready={workerReady && policiesLoaded}
          suggestedName={suggestedPolicyName}
          onStart={(preset, name) => startTraining(preset, name)}
          onPause={() => {
            workerRef.current?.postMessage({ type: "pause" } satisfies WorkerRequest);
            updateTrainingStatus("paused");
          }}
          onResume={() => {
            workerRef.current?.postMessage({ type: "resume" } satisfies WorkerRequest);
            updateTrainingStatus("running");
          }}
          onStop={() => {
            workerRef.current?.postMessage({ type: "stop" } satisfies WorkerRequest);
          }}
          onPlay={() => beginGame(randomSeed())}
          onBack={() => setScreen("home")}
        />
      )}

      {screen === "planning" && humanGame && (
        <Planning
          game={humanGame}
          plan={plan}
          setPlan={setPlan}
          warehouseBuys={warehouseBuys}
          setWarehouseBuys={setWarehouseBuys}
          onLock={lockIn}
          agentThinking={agentThinking}
          onQuit={() => setScreen("home")}
        />
      )}

      {screen === "replay" && replay && (
        <>
          <div className="replay-hud">
            <div className="replay-info">
              <span className="eyebrow">Day {replay.day + 1}</span>
              <strong>
                {replay.events.length} customers · same stream for both machines
              </strong>
            </div>
            <div className="replay-controls">
              <button
                className={replaySpeed === 1 ? "speed active" : "speed"}
                onClick={() => setReplaySpeed(1)}
              >
                1×
              </button>
              <button
                className={replaySpeed === 4 ? "speed active" : "speed"}
                onClick={() => setReplaySpeed(4)}
              >
                4×
              </button>
              <button className="primary" onClick={finishReplay}>
                Skip day
              </button>
            </div>
          </div>
          <div className="replay-hint">
            Precomputed customer log · thought bubble = item wanted · green =
            sold · amber ? = not stocked · red × = too expensive
          </div>
        </>
      )}

      {screen === "summary" && humanGame && agentGame && humanStats && agentStats && (
        <DaySummary
          humanStats={humanStats}
          agentStats={agentStats}
          humanDecision={humanDecision ?? { plans: [] }}
          agentDecision={agentDecision}
          humanHistory={humanGame.history}
          agentHistory={agentGame.history}
          isFinal={humanGame.day >= CONFIG.DAYS}
          onNext={() => {
            if (humanGame.day >= CONFIG.DAYS) setScreen("final");
            else nextDay();
          }}
        />
      )}

      {screen === "final" && humanGame && agentGame && (
        <FinalReport
          humanHistory={humanGame.history}
          agentHistory={agentGame.history}
          humanMachine={humanGame.machine}
          agentMachine={agentGame.machine}
          onPlaySame={() => {
            if (seed !== null) beginGame(seed);
          }}
          onNewSeed={() => beginGame(randomSeed())}
          onHome={() => setScreen("home")}
        />
      )}
    </>
  );
}
