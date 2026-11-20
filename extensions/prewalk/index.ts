/**
 * Prewalk: smart model plans + starts, cheap model finishes.
 *
 * Source: Can Bölük, "The Prewalk Technique," stencil.so/blog/prewalk (13 Jul 2026)
 * https://stencil.so/blog/prewalk — via https://news.ycombinator.com/item?id=48916512
 *
 * The insight: reading is ~91% of an agent's token spend, not thinking or writing.
 * A frontier model that hands off via a written /plan doc makes the cheap model
 * re-read everything from scratch — the read cost is paid twice. Prewalk instead
 * lets the frontier model start real execution (explore, draft a todo list, land
 * one actual code edit) and swaps models mid-context right after that first edit
 * lands, so the cheap model inherits a real exploration trajectory and a
 * partially-checked todo list — not a summary — plus one in-context example of
 * the right approach. The planning-only instruction is dropped from the system
 * prompt on handoff so the cheap model treats exploration as already done.
 *
 * /prewalk                          - arm with smart model (sol), cheap target (deepseek)
 * /prewalk <target>                  - arm with current model, custom target
 * /prewalk <smart> <target>          - arm with custom smart + target, switch to smart
 * /prewalk off                       - disarm
 *
 * Model refs accept a short alias: sol, deepseek, smart, cheap.
 * Defaults: smart = sol, target = deepseek
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

// Short names so nobody has to type provider/model-id at the gate.
const MODEL_ALIASES: Record<string, string> = {
  sol: "openai-codex/gpt-6.2-sol",
  smart: "openai-codex/gpt-6.2-sol",
  deepseek: "openrouter/deepseek/deepseek-v4.1-flash-1017",
  cheap: "openrouter/deepseek/deepseek-v4.1-flash-1017",
}

const DEFAULT_SMART = "sol"
const DEFAULT_TARGET = "deepseek"

function resolveModelRef(ref: string): string {
  const key = ref.trim().toLowerCase()
  return MODEL_ALIASES[key] ?? ref.trim()
}

const TODO_PATTERN = /(?:^|[\\/])(?:TODO|todo|TASK|task|PLAN|plan|CHECKLIST|checklist)\.(?:md|txt)$/

export default function (pi: ExtensionAPI) {
  let armed = false
  let handoffDone = false
  let targetModelId = DEFAULT_TARGET
  let todoCreated = false
  let editOrWriteThisTurn = false

  // ── detect todo creation and edit/write activity ──
  pi.on("tool_call", (event) => {
    if (handoffDone || !armed) return

    const isTodoWrite =
      event.toolName === "write" && event.input.path && TODO_PATTERN.test(String(event.input.path))

    if (isTodoWrite) {
      todoCreated = true
      return
    }

    // swap point is the first *code* edit, not the plan file itself
    if (event.toolName === "edit" || event.toolName === "write") {
      editOrWriteThisTurn = true
    }
  })

  // ── handoff check at turn end ──
  pi.on("turn_end", async (_event, ctx) => {
    if (!armed || handoffDone || !todoCreated || !editOrWriteThisTurn) {
      editOrWriteThisTurn = false
      return
    }

    const [provider, ...rest] = resolveModelRef(targetModelId).split("/")
    const modelId = rest.join("/")
    const targetModel = ctx.modelRegistry.find(provider, modelId)

    if (!targetModel) {
      ctx.ui.notify(`Prewalk: model "${targetModelId}" not found`, "error")
      armed = false
      return
    }

    handoffDone = true
    await pi.setModel(targetModel)
    ctx.ui.notify(`Prewalk: switched to ${targetModelId}`, "info")
  })

  // ── inject nudges ──
  pi.on("before_agent_start", (event) => {
    if (!armed) return

    if (!handoffDone) {
      return {
        systemPrompt:
          event.systemPrompt +
          "\n\n" +
          "Start by writing a concrete plan. Create a TODO.md breaking down the " +
          "work into small, verifiable items. Then start implementing.",
      }
    }

    return {
      systemPrompt:
        event.systemPrompt +
        "\n\n" +
        "Before finishing, go through the TODO.md and verify every item is complete. " +
        "Mark items as done once verified.",
    }
  })

  // ── reset on new session ──
  pi.on("session_start", () => {
    armed = false
    handoffDone = false
    todoCreated = false
    editOrWriteThisTurn = false
  })

  // ── /prewalk command ──
  pi.registerCommand("prewalk", {
    description: "Smart model plans, cheap model executes. /prewalk [smart] [target] | off",
    handler: async (args, ctx) => {
      if (args === "off") {
        armed = false
        handoffDone = false
        todoCreated = false
        ctx.ui.notify("Prewalk disarmed", "info")
        return
      }

      const parts = args ? args.trim().split(/\s+/) : []
      let smartModelId: string | null = null
      targetModelId = DEFAULT_TARGET

      if (parts.length >= 2) {
        // /prewalk <smart> <target>
        smartModelId = parts[0]
        targetModelId = parts[1]
      } else if (parts.length === 1) {
        // /prewalk <target>
        targetModelId = parts[0]
      } else {
        // /prewalk — smart starts on sol, cheap finishes on deepseek
        smartModelId = DEFAULT_SMART
      }

      // resolve target model
      const [tp, ...tr] = resolveModelRef(targetModelId).split("/")
      const targetModel = ctx.modelRegistry.find(tp, tr.join("/"))
      if (!targetModel) {
        ctx.ui.notify(`Prewalk: target "${targetModelId}" not found in model catalog`, "error")
        return
      }

      // resolve and switch to smart model if specified
      if (smartModelId) {
        const [sp, ...sr] = resolveModelRef(smartModelId).split("/")
        const smartModel = ctx.modelRegistry.find(sp, sr.join("/"))
        if (!smartModel) {
          ctx.ui.notify(`Prewalk: smart model "${smartModelId}" not found in model catalog`, "error")
          return
        }
        const ok = await pi.setModel(smartModel)
        if (!ok) {
          ctx.ui.notify(`Prewalk: failed to switch to ${smartModelId}`, "error")
          return
        }
      }

      const smart = smartModelId || (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "current")

      armed = true
      handoffDone = false
      todoCreated = false
      editOrWriteThisTurn = false

      ctx.ui.notify(`Prewalk armed: ${smart} → ${targetModelId}`, "info")
    },
  })
}