# Adding a local model provider

Nothing local is configured by default. When you run Ollama, LM Studio,
llama.cpp, MLX, or any other OpenAI-compatible server, add one provider block
to `.pi/agent/models.json` and it joins the routing.

## Example: Ollama

```json
"local": {
  "baseUrl": "http://127.0.0.1:11434/v1",
  "apiKey": "ollama",
  "api": "openai-completions",
  "compat": {
    "supportsDeveloperRole": false,
    "supportsReasoningEffort": false
  },
  "models": [
    {
      "id": "qwen3-coder:30b",
      "name": "Qwen3 Coder 30B (local)",
      "input": ["text"],
      "contextWindow": 262144,
      "maxTokens": 16384,
      "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
    }
  ]
}
```

For a server on another machine, replace `127.0.0.1` with its hostname. Any
OpenAI-compatible endpoint works the same way.

## Then

1. `id` must match what the server reports:
   `curl http://127.0.0.1:11434/v1/models`.
2. Keep the `cost` fields at zero so local work does not affect `fpi-cost`.
3. Add the model to `enabledModels` in `.pi/agent/settings.json` as
   `local/<id>` so it appears in the model picker.
4. Point a role at it in `.pi/agent/AGENTS.md`; the routing table there
   already uses `local` for high-volume, low-stakes work.

Providers are additive. Nothing else in the harness needs to change.

## About the provider blocks

`models.json` ships with a few provider definitions inherited from upstream
brayness. They are keyed on environment variables such as
`${ANTHROPIC_API_KEY}` and are inert unless you set those variables and add
their models to `enabledModels`. Delete any block you do not use.
