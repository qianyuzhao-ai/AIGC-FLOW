"use client";

import { type PiConfiguration, type PiConnection, piConnectionSchema } from "@aigc-flow/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { SettingsField } from "@/components/settings-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { apiError } from "@/lib/api-error";

export function SettingsPiSection() {
  const [configuration, setConfiguration] = useState<PiConfiguration | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [custom, setCustom] = useState(false);
  const [customId, setCustomId] = useState("custom-local");
  const [baseUrl, setBaseUrl] = useState("");
  const [protocol, setProtocol] =
    useState<NonNullable<PiConnection["custom"]>["api"]>("openai-completions");
  const [contextWindow, setContextWindow] = useState(32768);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [busy, setBusy] = useState<"load" | "save" | "verify" | null>("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    api.api.pi.configuration
      .$get({}, { init: { signal: controller.signal } })
      .then(async (res) => {
        if (!res.ok) throw await apiError(res);
        const value = await res.json();
        setConfiguration(value);
        setProvider(value.provider);
        setModel(value.model);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "读取 Pi 配置失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(null);
      });
    return () => request.current?.abort();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    const parsed = piConnectionSchema.safeParse({
      provider: custom ? customId : provider,
      model,
      apiKey,
      clearApiKey,
      ...(custom ? { custom: { baseUrl, api: protocol, contextWindow, maxTokens } } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "请检查配置");
      return;
    }
    setBusy("save");
    try {
      const res = await api.api.pi.configuration.$put({ json: parsed.data });
      if (!res.ok) throw await apiError(res);
      const value = await res.json();
      setConfiguration(value);
      setProvider(value.provider);
      setModel(value.model);
      setApiKey("");
      setClearApiKey(false);
      setCustom(false);
      setNotice("Pi 模型配置已保存");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    setError("");
    setNotice("");
    setBusy("verify");
    const controller = new AbortController();
    request.current = controller;
    try {
      const res = await api.api.pi.verify.$post({}, { init: { signal: controller.signal } });
      if (!res.ok) throw await apiError(res);
      const value = await res.json();
      setNotice(value.reply ? `${value.model}：${value.reply}` : `${value.model} 已接受请求`);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "验证失败");
    } finally {
      setBusy(null);
    }
  }

  const selected = configuration?.providers.find((item) => item.id === provider);
  const disabled = busy !== null;
  return (
    <form onSubmit={save} className="space-y-4">
      <p className="text-muted-foreground text-sm">
        选择对话使用的服务和模型。配置在当前应用中独立保存。
      </p>
      <SettingsField id="pi-provider" label="模型服务" hint="可使用 Pi 内置服务，或添加兼容接口。">
        <Select
          value={custom ? "__custom" : provider}
          disabled={disabled}
          onValueChange={(value) => {
            if (!value) return;
            setCustom(value === "__custom");
            setProvider(value === "__custom" ? "" : value);
            setModel("");
            setApiKey("");
            setClearApiKey(false);
            setNotice("");
          }}
        >
          <SelectTrigger id="pi-provider" className="w-full">
            <SelectValue placeholder="选择模型服务" />
          </SelectTrigger>
          <SelectContent>
            {configuration?.providers.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
                {item.configured ? " · 已配置" : ""}
              </SelectItem>
            ))}
            <SelectItem value="__custom">添加自定义服务…</SelectItem>
          </SelectContent>
        </Select>
      </SettingsField>
      {custom && (
        <>
          <SettingsField
            id="pi-custom-id"
            label="服务标识"
            hint="以 custom- 开头，例如 custom-local。相同标识会更新已有服务。"
          >
            <Input
              id="pi-custom-id"
              value={customId}
              disabled={disabled}
              onChange={(e) => setCustomId(e.target.value)}
            />
          </SettingsField>
          <SettingsField
            id="pi-url"
            label="基础地址"
            hint="填到版本路径，例如 http://localhost:11434/v1。"
          >
            <Input
              id="pi-url"
              value={baseUrl}
              disabled={disabled}
              onChange={(e) => setBaseUrl(e.target.value)}
              autoComplete="off"
            />
          </SettingsField>
          <SettingsField id="pi-protocol" label="接口协议" hint="选择服务实际支持的请求格式。">
            <Select
              value={protocol}
              disabled={disabled}
              onValueChange={(value) => setProtocol(value as typeof protocol)}
            >
              <SelectTrigger id="pi-protocol" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-completions">OpenAI Chat Completions</SelectItem>
                <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
                <SelectItem value="anthropic-messages">Anthropic Messages</SelectItem>
              </SelectContent>
            </Select>
          </SettingsField>
          <div className="grid grid-cols-2 gap-3">
            <SettingsField id="pi-context" label="上下文长度" hint="输入与输出的总上限。">
              <Input
                id="pi-context"
                type="number"
                min={1}
                value={contextWindow}
                disabled={disabled}
                onChange={(e) => setContextWindow(Number(e.target.value))}
              />
            </SettingsField>
            <SettingsField id="pi-max-tokens" label="最大输出 Token" hint="单次回复的输出上限。">
              <Input
                id="pi-max-tokens"
                type="number"
                min={1}
                value={maxTokens}
                disabled={disabled}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
              />
            </SettingsField>
          </div>
          <p className="text-muted-foreground text-xs">
            按服务的实际限制填写，上面的初始值仅作起点。
          </p>
        </>
      )}
      <SettingsField
        id="pi-model"
        label="模型"
        hint={custom ? "填写服务实际提供的模型 ID。" : "输入或选择 Pi 模型目录中的模型。"}
      >
        <Input
          id="pi-model"
          list={custom ? undefined : "pi-models"}
          value={model}
          disabled={disabled}
          onChange={(e) => {
            setModel(e.target.value);
            setNotice("");
          }}
          autoComplete="off"
        />
        <datalist id="pi-models">
          {selected?.models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </datalist>
      </SettingsField>
      <SettingsField
        id="pi-key"
        label="API Key"
        hint={
          custom
            ? "无需鉴权的本地服务可留空；已有服务留空则保留其凭据。"
            : "留空保留该服务已有的凭据，也可使用服务端已配置的环境变量。"
        }
      >
        <Input
          id="pi-key"
          type="password"
          value={apiKey}
          disabled={disabled || clearApiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
        />
      </SettingsField>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={clearApiKey}
          disabled={disabled}
          onChange={(e) => {
            setClearApiKey(e.target.checked);
            setApiKey("");
          }}
        />
        清除该服务已保存的凭据
      </label>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={disabled}>
          {busy === "save" ? "保存中…" : "保存模型配置"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !configuration?.model}
          onClick={verify}
        >
          {busy === "verify" ? "验证中…" : "验证已保存的模型"}
        </Button>
      </div>
    </form>
  );
}
