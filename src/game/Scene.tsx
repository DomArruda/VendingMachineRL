import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { DayEvent } from "../sim/day";
import { ITEM_BY_ID } from "../sim/items";
import type { Slot } from "../sim/machine";

export interface SceneReplay {
  key: number;
  day: number;
  events: { human: DayEvent; agent: DayEvent }[];
  humanSlots: Slot[];
  agentSlots: Slot[];
}

interface SceneProps {
  humanSlots: Slot[] | null;
  agentSlots: Slot[] | null;
  replay: SceneReplay | null;
  replaySpeed: number;
  onReplayDone: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  chips: "#f59e0b",
  candy: "#ec4899",
  soda: "#38bdf8",
  water: "#22d3ee",
  healthy: "#4ade80",
  premium: "#a78bfa",
};

const BANDANA_COLORS = [0xfbbf24, 0xf472b6, 0x60a5fa, 0x34d399, 0xa78bfa];

const START_HUMAN = new THREE.Vector3(-2.25, 0.32, 2.15);
const START_AGENT = new THREE.Vector3(2.25, 0.32, 2.15);
const FRONT_HUMAN = new THREE.Vector3(-2.25, 0.32, 1.0);
const FRONT_AGENT = new THREE.Vector3(2.25, 0.32, 1.0);

interface CapybaraModel {
  group: THREE.Group;
  legs: THREE.Group[];
  bandana: THREE.MeshStandardMaterial;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - radius,
    y + height
  );
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function makeSign(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#0b1018";
  context.fillRect(0, 0, 256, 64);
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.strokeRect(2, 2, 252, 60);
  context.fillStyle = color;
  context.font = "bold 30px ui-monospace, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 128, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeSlotTexture(slot: Slot | undefined): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 144;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#0b1018";
  context.fillRect(0, 0, 128, 144);

  const item = slot?.itemId ? ITEM_BY_ID[slot.itemId] : null;
  if (!item) {
    context.strokeStyle = "#283244";
    context.lineWidth = 4;
    context.strokeRect(3, 3, 122, 138);
    context.fillStyle = "#334155";
    context.font = "30px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText("—", 64, 82);
  } else {
    const color = CATEGORY_COLORS[item.category] ?? "#94a3b8";
    context.fillStyle = color;
    context.globalAlpha = 0.16;
    context.fillRect(3, 3, 122, 138);
    context.globalAlpha = 1;
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.strokeRect(3, 3, 122, 138);
    context.font = "58px 'Segoe UI Emoji', 'Apple Color Emoji', serif";
    context.textAlign = "center";
    context.fillText(item.icon, 64, 84);
    context.fillStyle = "#e5e7eb";
    context.font = "bold 22px ui-monospace, monospace";
    context.textAlign = "left";
    context.fillText(`x${slot?.qty ?? 0}`, 8, 134);
    if ((slot?.qty ?? 0) === 0) {
      context.fillStyle = "rgba(5, 8, 14, 0.55)";
      context.fillRect(3, 3, 122, 138);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeBubbleTexture(
  icon: string,
  title: string,
  subtitle: string,
  color: string
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 160;
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, 320, 160);
  context.fillStyle = "rgba(9, 14, 23, 0.94)";
  roundedRect(context, 3, 3, 314, 154, 22);
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = 3;
  roundedRect(context, 3, 3, 314, 154, 22);
  context.stroke();
  context.font = "60px 'Segoe UI Emoji', 'Apple Color Emoji', serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(icon, 62, 82);
  context.textAlign = "left";
  context.fillStyle = color;
  context.font = "bold 21px ui-monospace, monospace";
  context.fillText(title.slice(0, 16), 116, 66);
  context.fillStyle = "#94a3b8";
  context.font = "16px ui-monospace, monospace";
  context.fillText(subtitle, 116, 100);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function thoughtTexture(event: DayEvent): THREE.CanvasTexture {
  const item = ITEM_BY_ID[event.desiredItemId];
  return makeBubbleTexture(item.icon, item.name, "wants", "#94a3b8");
}

function outcomeTexture(event: DayEvent): THREE.CanvasTexture {
  if (event.outcome === "buy" && event.soldItemId) {
    const item = ITEM_BY_ID[event.soldItemId];
    return makeBubbleTexture(item.icon, item.name, "sold", "#4ade80");
  }
  if (event.reason === "not-stocked") {
    return makeBubbleTexture("?", "Not stocked", "walked away", "#fbbf24");
  }
  return makeBubbleTexture("×", "Too expensive", "walked away", "#f87171");
}

export default function Scene({
  humanSlots,
  agentSlots,
  replay,
  replaySpeed,
  onReplayDone,
}: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const humanSlotsRef = useRef<THREE.Mesh[]>([]);
  const agentSlotsRef = useRef<THREE.Mesh[]>([]);
  const humanCustomerRef = useRef<CapybaraModel | null>(null);
  const agentCustomerRef = useRef<CapybaraModel | null>(null);
  const humanThoughtRef = useRef<THREE.Sprite | null>(null);
  const agentThoughtRef = useRef<THREE.Sprite | null>(null);
  const humanOutcomeRef = useRef<THREE.Sprite | null>(null);
  const agentOutcomeRef = useRef<THREE.Sprite | null>(null);
  const targetRef = useRef({
    human: START_HUMAN.clone(),
    agent: START_AGENT.clone(),
  });
  const speedRef = useRef(replaySpeed);
  const onDoneRef = useRef(onReplayDone);
  speedRef.current = replaySpeed;
  onDoneRef.current = onReplayDone;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x12141c, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x12141c, 8, 18);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
    camera.position.set(0, 2.4, 7.2);
    camera.lookAt(0, 1.1, 0.3);

    scene.add(new THREE.AmbientLight(0x94a3b8, 1.3));
    const light = new THREE.DirectionalLight(0xffffff, 2.4);
    light.position.set(3, 6, 4);
    scene.add(light);
    const rim = new THREE.PointLight(0x4ade80, 9, 9);
    rim.position.set(-2.6, 3, 2);
    scene.add(rim);
    const rim2 = new THREE.PointLight(0x60a5fa, 9, 9);
    rim2.position.set(2.6, 3, 2);
    scene.add(rim2);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.MeshStandardMaterial({ color: 0x0d121b, roughness: 0.92 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const grid = new THREE.GridHelper(24, 24, 0x1c2636, 0x141c28);
    grid.position.y = 0.002;
    scene.add(grid);

    const makeMachine = (
      x: number,
      label: string,
      color: string
    ): { slots: THREE.Mesh[] } => {
      const group = new THREE.Group();
      group.position.x = x;
      scene.add(group);

      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.15, 2.4, 0.7),
        new THREE.MeshStandardMaterial({
          color: 0x1b2433,
          metalness: 0.45,
          roughness: 0.45,
        })
      );
      body.position.y = 1.2;
      group.add(body);

      const front = new THREE.Mesh(
        new THREE.PlaneGeometry(1.02, 2.2),
        new THREE.MeshStandardMaterial({ color: 0x0c1320, roughness: 0.8 })
      );
      front.position.set(0, 1.2, 0.351);
      group.add(front);

      const slots: THREE.Mesh[] = [];
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 3; col++) {
          const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(0.26, 0.32),
            new THREE.MeshBasicMaterial({ color: 0x334155 })
          );
          mesh.position.set(
            (col - 1) * 0.31,
            1.15 + (1.5 - row) * 0.4,
            0.365
          );
          group.add(mesh);
          slots.push(mesh);
        }
      }

      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(0.92, 0.23),
        new THREE.MeshBasicMaterial({
          map: makeSign(label, color),
          transparent: true,
        })
      );
      sign.position.set(0, 2.56, 0.36);
      group.add(sign);

      const tray = new THREE.Mesh(
        new THREE.BoxGeometry(0.78, 0.09, 0.08),
        new THREE.MeshStandardMaterial({
          color: 0x0a0f18,
          metalness: 0.7,
          roughness: 0.3,
        })
      );
      tray.position.set(0, 0.24, 0.37);
      group.add(tray);

      return { slots };
    };

    const human = makeMachine(-1.55, "YOU", "#4ade80");
    const agent = makeMachine(1.55, "AGENT", "#60a5fa");
    humanSlotsRef.current = human.slots;
    agentSlotsRef.current = agent.slots;

    const makeCapybara = (x: number, yaw: number): CapybaraModel => {
      const group = new THREE.Group();
      group.position.set(x, 0.32, 2.15);
      group.rotation.y = yaw;
      group.visible = false;
      scene.add(group);

      const sphere = new THREE.SphereGeometry(1, 12, 8);
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: 0xa66c3d,
        roughness: 0.9,
        flatShading: true,
      });
      const body = new THREE.Mesh(sphere, bodyMaterial);
      body.scale.set(0.31, 0.2, 0.42);
      group.add(body);

      const headMaterial = new THREE.MeshStandardMaterial({
        color: 0xb77a47,
        roughness: 0.88,
        flatShading: true,
      });
      const head = new THREE.Mesh(sphere, headMaterial);
      head.position.set(0, 0.07, 0.27);
      head.scale.set(0.145, 0.12, 0.145);
      group.add(head);

      const muzzle = new THREE.Mesh(
        sphere,
        new THREE.MeshStandardMaterial({
          color: 0xd7a16b,
          roughness: 0.92,
          flatShading: true,
        })
      );
      muzzle.position.set(0, 0.02, 0.41);
      muzzle.scale.set(0.085, 0.065, 0.17);
      group.add(muzzle);

      const darkMaterial = new THREE.MeshStandardMaterial({
        color: 0x38251b,
        roughness: 0.72,
      });
      const nose = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 10, 8),
        darkMaterial
      );
      nose.position.set(0, 0.04, 0.565);
      group.add(nose);

      const nostrilMaterial = new THREE.MeshStandardMaterial({ color: 0x1f1712 });
      for (const side of [-1, 1]) {
        const nostril = new THREE.Mesh(
          new THREE.SphereGeometry(0.008, 6, 5),
          nostrilMaterial
        );
        nostril.position.set(side * 0.014, 0.047, 0.588);
        group.add(nostril);
      }

      const eyeMaterial = new THREE.MeshStandardMaterial({
        color: 0x17110e,
        roughness: 0.45,
      });
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(
          new THREE.SphereGeometry(0.017, 8, 6),
          eyeMaterial
        );
        eye.position.set(side * 0.12, 0.125, 0.32);
        group.add(eye);

        const ear = new THREE.Mesh(
          new THREE.SphereGeometry(0.036, 10, 8),
          headMaterial
        );
        ear.position.set(side * 0.105, 0.19, 0.22);
        ear.scale.set(0.9, 1, 0.7);
        group.add(ear);
      }

      const bandana = new THREE.MeshStandardMaterial({
        color: BANDANA_COLORS[0],
        roughness: 0.8,
        flatShading: true,
      });
      const collar = new THREE.Mesh(sphere, bandana);
      collar.position.set(0, -0.07, 0.18);
      collar.scale.set(0.19, 0.045, 0.07);
      group.add(collar);

      const legs: THREE.Group[] = [];
      const legMaterial = new THREE.MeshStandardMaterial({
        color: 0x704529,
        roughness: 0.92,
        flatShading: true,
      });
      for (const side of [-1, 1]) {
        for (const fore of [-1, 1]) {
          const legGroup = new THREE.Group();
          legGroup.position.set(side * 0.19, -0.15, fore * 0.26);
          const leg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.035, 0.045, 0.16, 8),
            legMaterial
          );
          leg.position.y = -0.08;
          legGroup.add(leg);
          group.add(legGroup);
          legs.push(legGroup);
        }
      }

      return { group, legs, bandana };
    };
    const humanCustomer = makeCapybara(-2.25, 2.32);
    const agentCustomer = makeCapybara(2.25, -2.32);
    humanCustomerRef.current = humanCustomer;
    agentCustomerRef.current = agentCustomer;

    const makeSprite = (x: number, y: number, z: number): THREE.Sprite => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          transparent: true,
          depthTest: false,
        })
      );
      sprite.position.set(x, y, z);
      sprite.scale.set(1.15, 0.58, 1);
      sprite.visible = false;
      sprite.renderOrder = 10;
      scene.add(sprite);
      return sprite;
    };
    humanThoughtRef.current = makeSprite(-1.55, 1.4, 2.15);
    agentThoughtRef.current = makeSprite(1.55, 1.4, 2.15);
    humanOutcomeRef.current = makeSprite(-1.55, 3.0, 0.35);
    agentOutcomeRef.current = makeSprite(1.55, 3.0, 0.35);

    const resize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    const clock = new THREE.Clock();
    let raf = 0;
    const loop = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      const time = clock.elapsedTime;
      const lerp = 1 - Math.exp(-12 * delta);
      humanCustomer.group.position.lerp(targetRef.current.human, lerp);
      agentCustomer.group.position.lerp(targetRef.current.agent, lerp);
      humanCustomer.group.position.y =
        targetRef.current.human.y +
        Math.abs(Math.sin(time * 5.5)) * 0.025;
      agentCustomer.group.position.y =
        targetRef.current.agent.y +
        Math.abs(Math.sin(time * 5.5 + 0.9)) * 0.025;
      humanCustomer.legs.forEach((leg, index) => {
        leg.rotation.x = humanCustomer.group.visible
          ? Math.sin(time * 15 + index * Math.PI) * 0.28
          : 0;
      });
      agentCustomer.legs.forEach((leg, index) => {
        leg.rotation.x = agentCustomer.group.visible
          ? Math.sin(time * 15 + index * Math.PI) * 0.28
          : 0;
      });

      if (humanThoughtRef.current?.visible) {
        humanThoughtRef.current.position.set(
          humanCustomer.group.position.x,
          humanCustomer.group.position.y + 0.95,
          humanCustomer.group.position.z
        );
      }
      if (agentThoughtRef.current?.visible) {
        agentThoughtRef.current.position.set(
          agentCustomer.group.position.x,
          agentCustomer.group.position.y + 0.95,
          agentCustomer.group.position.z
        );
      }
      for (const sprite of [
        humanOutcomeRef.current,
        agentOutcomeRef.current,
      ]) {
        if (!sprite?.visible) continue;
        sprite.position.y = 3.0 + Math.sin(time * 4) * 0.035;
        const pulse = 1 + Math.sin(time * 5) * 0.03;
        sprite.scale.set(1.15 * pulse, 0.58 * pulse, 1);
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) {
            for (const entry of material) entry.dispose();
          } else {
            material.dispose();
          }
        } else if (object instanceof THREE.Sprite) {
          object.material.map?.dispose();
          object.material.dispose();
        }
      });
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    const paint = (meshes: THREE.Mesh[], slots: Slot[] | null) => {
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i];
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.map?.dispose();
        material.map = makeSlotTexture(slots?.[i]);
        material.color.set(0xffffff);
        material.needsUpdate = true;
      }
    };
    paint(humanSlotsRef.current, humanSlots);
    paint(agentSlotsRef.current, agentSlots);
  }, [humanSlots, agentSlots]);

  useEffect(() => {
    const human = humanCustomerRef.current;
    const agentCustomer = agentCustomerRef.current;
    const humanThought = humanThoughtRef.current;
    const agentThought = agentThoughtRef.current;
    const humanOutcome = humanOutcomeRef.current;
    const agentOutcome = agentOutcomeRef.current;
    if (
      !replay ||
      !human ||
      !agentCustomer ||
      !humanThought ||
      !agentThought ||
      !humanOutcome ||
      !agentOutcome
    ) {
      return;
    }

    let cancelled = false;
    let timer = 0;
    let index = 0;
    let activeThought: THREE.CanvasTexture | null = null;
    let activeHumanOutcome: THREE.CanvasTexture | null = null;
    let activeAgentOutcome: THREE.CanvasTexture | null = null;

    const hideThought = () => {
      humanThought.visible = false;
      agentThought.visible = false;
    };
    const hideOutcomes = () => {
      humanOutcome.visible = false;
      agentOutcome.visible = false;
    };
    const setThought = (event: DayEvent) => {
      const texture = thoughtTexture(event);
      activeThought?.dispose();
      activeThought = texture;
      for (const sprite of [humanThought, agentThought]) {
        const material = sprite.material as THREE.SpriteMaterial;
        material.map = texture;
        material.needsUpdate = true;
        sprite.visible = true;
      }
    };
    const setOutcomes = (pair: { human: DayEvent; agent: DayEvent }) => {
      const humanTexture = outcomeTexture(pair.human);
      const agentTexture = outcomeTexture(pair.agent);
      activeHumanOutcome?.dispose();
      activeAgentOutcome?.dispose();
      activeHumanOutcome = humanTexture;
      activeAgentOutcome = agentTexture;
      (humanOutcome.material as THREE.SpriteMaterial).map = humanTexture;
      (humanOutcome.material as THREE.SpriteMaterial).needsUpdate = true;
      (agentOutcome.material as THREE.SpriteMaterial).map = agentTexture;
      (agentOutcome.material as THREE.SpriteMaterial).needsUpdate = true;
      humanOutcome.visible = true;
      agentOutcome.visible = true;
    };
    const resetPositions = () => {
      human.group.position.copy(START_HUMAN);
      agentCustomer.group.position.copy(START_AGENT);
      targetRef.current.human.copy(FRONT_HUMAN);
      targetRef.current.agent.copy(FRONT_AGENT);
    };

    const step = () => {
      if (cancelled) return;
      if (index >= replay.events.length) {
        hideThought();
        hideOutcomes();
        human.group.visible = false;
        agentCustomer.group.visible = false;
        onDoneRef.current();
        return;
      }

      const pair = replay.events[index];
      const color = BANDANA_COLORS[index % BANDANA_COLORS.length];
      human.bandana.color.setHex(color);
      agentCustomer.bandana.color.setHex(color);
      human.group.visible = true;
      agentCustomer.group.visible = true;
      resetPositions();
      hideOutcomes();
      setThought(pair.human);

      timer = window.setTimeout(() => {
        if (cancelled) return;
        setOutcomes(pair);
        timer = window.setTimeout(() => {
          if (cancelled) return;
          hideThought();
          hideOutcomes();
          targetRef.current.human.copy(START_HUMAN);
          targetRef.current.agent.copy(START_AGENT);
          timer = window.setTimeout(() => {
            if (cancelled) return;
            index++;
            step();
          }, 180 / Math.max(1, speedRef.current));
        }, 360 / Math.max(1, speedRef.current));
      }, 240 / Math.max(1, speedRef.current));
    };

    step();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      hideThought();
      hideOutcomes();
      human.group.visible = false;
      agentCustomer.group.visible = false;
      activeThought?.dispose();
      activeHumanOutcome?.dispose();
      activeAgentOutcome?.dispose();
    };
  }, [replay?.key]);

  return <canvas ref={canvasRef} />;
}
