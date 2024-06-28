import { Context, Schema, h } from "koishi"
import { inspect } from "node:util"

export const name = "lolimi-mfcat35"

export interface Config {
  prompt: string
  prefix: string[]
  apiUrl: string
  failureKeywords: string[]
}

export const Config: Schema<Config> = Schema.object({
  prompt: Schema.string()
    .description("提示词。“@@\\_\\_BOTNAME\\_\\_@@”将被替换为机器人的昵称。")
    .default(
      "You are @@__BOTNAME__@@, a chatbot based on ChatGPT, " +
        "a large language model trained by OpenAI based on the GPT-3.5 architecture.\n" +
        "You are chatting with the user via koishi.js, a cross-platform, " +
        "extensible and high-performance chatbot framework, " +
        "which means most of the time your lines should be a sentence or two, " +
        "unless the user's request requires reasoning or long-form outputs.\n" +
        "Never use emojis, unless explicitly asked to."
    )
    .role("textarea"),
  prefix: Schema.array(String)
    .description("触发 AI 回复的消息前缀。消息首尾空格会被自动移除，以空格开头无效。")
    .default(["：", ":"])
    .role("table"),
  apiUrl: Schema.string()
    .description("API URL。提示词和用户输入文本将分别以 URL 参数 sx 和 msg 传递。")
    .default("https://api.lolimi.cn/API/AI/mfcat3.5.php")
    .role("textarea"),
  failureKeywords: Schema.array(String)
    .description(
      "接口返回的内容包含这些字符串之一时，视为请求失败；此时只要不是直接显式调用 mfcat35 指令，都会静默返回空字符串，只在日志中记录具体结果。"
    )
    .default([
      "ApiKey账户余额不足",
      "Insufficient account balance",
      "无效的 API Key",
      "输出错误请联系站长",
    ]),
})

function getConfiguredNickname(ctx: Context) {
  const nickname = ctx.root.config.nickname
  if (Array.isArray(nickname)) return nickname[0]
  return nickname
}

export function apply(ctx: Context, config: Config) {
  const nickname = getConfiguredNickname(ctx)
  const logger = ctx.logger("mfcat35")
  ctx.i18n.define("zh", require("./locales/zh"))

  const cmd = ctx.command("mfcat35 <text:text>")
  cmd.action(async ({ session, root }, text) => {
    logger.debug("input " + inspect(text))
    const response = await ctx.http.get(config.apiUrl, {
      params: {
        sx: config.prompt.replaceAll(
          "@@__BOTNAME__@@",
          nickname || session.bot.user.name || "Koishi"
        ),
        msg: text,
      },
      responseType: "text",
    })
    if (config.failureKeywords.some(k => response.includes(k))) {
      logger.error("error response " + inspect(response))
      if (!root) return ""
    } else {
      logger.debug("response " + inspect(response))
    }
    return h.escape(response)
  })

  ctx.middleware(async (session, next) => {
    function sanitizeInput(elements: h[]): Promise<h[]> {
      return h.transformAsync(elements, {
        at: async e => {
          const name =
            e.type ||
            (await session.bot.getUser(e.id).then(
              u => u.name,
              () => ""
            )) ||
            (!session.isDirect &&
              (await session.bot.getGuildMember(session.guildId, e.id).then(
                u => u.name,
                () => ""
              ))) ||
            e.name ||
            e.id
          return `@${name}`
        },
        author: e => `${e.name || e.id} said: `,
        sharp: e => `#${e.name || e.id}`,
        a: async (e, children) => [
          "[",
          ...(await sanitizeInput(children)),
          "](",
          h.text(e.href),
          ")",
        ],
        image: "[Image]",
        img: "[Image]",
        audio: "[Audio message]",
        video: "[Video]",
        file: "[Attachment]",
        br: "\n",
        p: async (_, children) => ["\n", ...(await sanitizeInput(children)), "\n"],
        message: async (_, children) => ["\n", ...(await sanitizeInput(children)), "\n"],
        face: e => (e.name ? `[${e.name} Emoji]` : "[Emoji]"),
        text: true,
        default: (_, children) => sanitizeInput(children),
      })
    }

    let implicit = session.isDirect || session.stripped.appel
    let explicit = false
    let content = (await sanitizeInput(session.elements)).join("").trim()
    if (!content) return next()

    for (const prefix of config.prefix) {
      if (content.startsWith(prefix)) {
        if (prefix) explicit = true
        else implicit = true
        content = content.slice(prefix.length).trimStart()
        break
      }
    }

    if (explicit) {
      return cmd.execute({ args: [content] }, next)
    }
    if (implicit) {
      logger.debug("temporary middleware " + inspect(content))
      return next(next => cmd.execute({ args: [content] }, next))
    }
    return next()
  })
}
