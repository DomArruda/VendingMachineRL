# Vending Wars

A browser game where you manage a vending machine for 15 days against a small PPO neural policy. Both machines receive the same precomputed customer stream and wholesale prices. The simulation and the replay use the same TypeScript source of truth.

The planning screen includes an optional 60-unit backstock reserve, bulk-buy and refill controls, sortable catalog columns, and a random-fill action for empty machine slots that stays within available cash. Trained browser policies are stored in IndexedDB and can be selected or cleared without deleting the bundled policy.

## Run locally

```sh
bun install
bun run dev
```

## Checks and builds

```sh
bun test
bun run headless       # 10,000 simulated 15-day games per heuristic
bun run build          # creates dist/index.html as a single-file app
```

`dist/` is generated and ignored by Git. The repository keeps the app sources, simulation, RL code, tests, scripts, and pretrained policy so they can be reviewed before building.

## Source layout

- `src/sim/` — seeded market, items, customers, machine rules, episodes, and heuristics
- `src/rl/` — observations, masked actions, PPO training, worker, policy I/O, pretrained policy
- `src/game/` — Three.js scene and React game screens
- `scripts/` — headless balance check, training CLI, pretrained-weight packaging helper, and browser smoke tests
- `tests/` — simulation and RL action/decoder checks

The bundled weights and training metadata are in `src/data/pretrained/ppo.json`. The model is public client-side data, not a secret. The current checkpoint was created with an expert-cloning warm start followed by PPO. Its recorded 50-simulation held-out mean is $99.30 (standard deviation $11.48), compared with $125.48 for the greedy expert; PPO has not yet beaten that benchmark.

## GitHub Pages

Pushing to `main` runs tests, builds the single HTML file, and deploys `dist/` with `.github/workflows/deploy.yml`. Enable GitHub Pages with **GitHub Actions** as the source in the repository settings.
