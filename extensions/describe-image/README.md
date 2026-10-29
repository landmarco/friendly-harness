# Describe Image

A pi extension that describes images using a local vision server. Works with
any LLM, including text-only models. No API costs.

## How it works

Two modes:

1. **Automatic** - drop an image in chat. The extension checks whether the
   current model supports images natively:
   - **Vision-capable model** (Claude, GPT-4o, Gemini): lets the model see the
     image directly - zero latency added.
   - **Text-only model** (DeepSeek, Kimi, GLM without vision): describes the
     image with the local vision server and injects the description as text.

2. **Manual** - use the `describe_image` tool to describe an image by path or
   URL:

```
describe_image(path: "~/Pictures/screenshot.png")
```

## Setup

Any OpenAI-compatible vision server works - MLX, Ollama, LM Studio,
llama.cpp. Two env vars point at it:

| Variable           | Default                                        | Required |
| ------------------ | ---------------------------------------------- | -------- |
| `FPI_VISION_URL`   | `http://127.0.0.1:8080/v1/chat/completions`     | no       |
| `FPI_VISION_MODEL` | none                                           | **yes**  |

`FPI_VISION_MODEL` is the model id as your server expects it. MLX wants a
local model path; Ollama and LM Studio want a registry name. Examples:

```bash
# Ollama on this machine
export FPI_VISION_URL="http://127.0.0.1:11434/v1/chat/completions"
export FPI_VISION_MODEL="qwen2.5vl:7b"

# Ollama on the Mac mini
export FPI_VISION_URL="http://mac-mini.local:11434/v1/chat/completions"
export FPI_VISION_MODEL="qwen2.5vl:7b"
```

Confirm the server is up before relying on it:

```bash
curl "${FPI_VISION_URL%/chat/completions}/models"
```

**With `FPI_VISION_MODEL` unset the extension stays dormant.** Images pass
through untouched and you get one warning per session. Nothing breaks.

See `docs/local-models.md` for wiring the same server in as a text provider.

## Usage

### Drop an image in chat

Paste or drag an image into pi. If the current model can't see images, the
extension describes it automatically. If the model already has vision, it
passes through untouched.

### Manual tool

```
What's in this UI screenshot?
```

The agent calls `describe_image` with the file path.

### Focus area

Narrow what the model pays attention to:

```
describe_image(path: "screenshot.png", focus: "accessibility issues")
```

(`detail: "low" | "high"` is accepted for compatibility; both map to the same
local model.)
