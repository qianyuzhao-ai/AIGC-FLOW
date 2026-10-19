"use client";

import {
  type PiConfiguration,
  type PiConnection,
  type PiModelOption,
  type PiProviderView,
  piConnectionSchema,
  piModelsRequestSchema,
} from "@aigc-flow/shared";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
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
  const [creating, setCreating] = useState(false);
  const [customId, setCustomId] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [protocol, setProtocol] =
    useState<NonNullable<PiConnection["custom"]>["api"]>("openai-completions");
  const [contextWindow, setContextWindow] = useState(32768);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [supportsImages, setSupportsImages] = useState(false);
  const [reasoning, setReasoning] = useState(false);
  const [remoteModels, setRemoteModels] = useState<PiModelOption[]>([]);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState<"load" | "save" | "verify" | "models" | null>("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  const selected = configuration?.providers.find((item) => item.id === provider);
  const custom = creating || Boolean(selected?.custom);
  const options = remoteModels.length > 0 ? remoteModels : (selected?.models ?? []);
  const useSelect =
    options.length > 0 && !manual && (!model || options.some((item) => item.id === model));
  const disabled = busy !== null;

  const chooseProvider = useCallback(
    (value: PiProviderView | undefined, modelId = value?.models[0]?.id ?? "") => {
      setCreating(false);
      setProvider(value?.id ?? "");
      setModel(modelId);
      setServiceName(value?.name ?? "");
      setBaseUrl(value?.custom?.baseUrl ?? "");
      setProtocol(value?.custom?.api ?? "openai-completions");
      const metadata = value?.models.find((item) => item.id === modelId);
      setContextWindow(metadata?.contextWindow ?? 32768);
      setMaxTokens(metadata?.maxTokens ?? 4096);
      setSupportsImages(metadata?.input.includes("image") ?? false);
      setReasoning(metadata?.reasoning ?? false);
      setApiKey("");
      setClearApiKey(false);
      setRemoteModels([]);
      setManual(false);
      setError("");
      setNotice("");
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    api.api.pi.configuration
      .$get({}, { init: { signal: controller.signal } })
      .then(async (res) => {
        if (!res.ok) throw await apiError(res);
        const value = await res.json();
        if (controller.signal.aborted) return;
        setConfiguration(value);
        chooseProvider(
          value.providers.find((item) => item.id === value.provider),
          value.model,
        );
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "读取 Pi 配置失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(null);
      });
    return () => request.current?.abort();
  }, [chooseProvider]);

  function chooseModel(value: string) {
    if (!value) return;
    setModel(value);
    setNotice("");
    const metadata = selected?.models.find((item) => item.id === value);
    setContextWindow(metadata?.contextWindow ?? 32768);
    setMaxTokens(metadata?.maxTokens ?? 4096);
    setSupportsImages(metadata?.input.includes("image") ?? false);
    setReasoning(metadata?.reasoning ?? false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    const parsed = piConnectionSchema.safeParse({
      provider: creating ? customId : provider,
      model,
      apiKey,
      clearApiKey,
      ...(custom
        ? {
            custom: {
              name: serviceName,
              baseUrl,
              api: protocol,
              contextWindow,
              maxTokens,
              input: supportsImages ? ["text", "image"] : ["text"],
              reasoning,
            },
          }
        : {}),
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
      chooseProvider(
        value.providers.find((item) => item.id === value.provider),
        value.model,
      );
      setNotice("Pi 模型配置已保存");
      window.dispatchEvent(new Event("pi-configuration-changed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(null);
    }
  }

  async function loadModels() {
    if (busy) return;
    setError("");
    setNotice("");
    const parsed = piModelsRequestSchema.safeParse({
      provider: creating ? customId : provider,
      baseUrl,
      apiKey,
      clearApiKey,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "请检查服务地址");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy("models");
    try {
      const res = await api.api.pi.models.$post(
        { json: parsed.data },
        { init: { signal: controller.signal } },
      );
      if (!res.ok) throw await apiError(res);
      const value = await res.json();
      if (controller.signal.aborted) return;
      setRemoteModels(value.models);
      setManual(false);
      if (!model) setModel(value.models[0]?.id ?? "");
      setNotice(`已读取 ${value.models.length} 个模型，请选择后保存`);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setManual(true);
        setError(cause instanceof Error ? cause.message : "读取失败，可以手动填写模型 ID");
      }
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  async function verify() {
    if (busy) return;
    setError("");
    setNotice("");
    setBusy("verify");
    const controller = new AbortController();
    request.current = controller;
    try {
      const res = await api.api.pi.verify.$post({}, { init: { signal: controller.signal } });
      if (!res.ok) throw await apiError(res);
      const value = await res.json();
      if (!controller.signal.aborted)
        setNotice(value.reply ? `${value.model}：${value.reply}` : `${value.model} 已接受请求`);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "验证失败");
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <p className="text-muted-foreground text-sm">
        支持官方模型服务、第三方聚合 API 和本地兼容接口。
      </p>
      <SettingsField
        id="pi-provider"
        label="模型服务"
        hint="聚合服务使用自己的地址和 Key，可接入多个不同服务。"
      >
        <Select
          value={creating ? "__custom" : provider}
          disabled={disabled}
          onValueChange={(value) => {
            if (!value) return;
            if (value === "__custom") {
              chooseProvider(undefined);
              setCreating(true);
              setCustomId(`custom-${crypto.randomUUID()}`);
              setManual(true);
            } else chooseProvider(configuration?.providers.find((item) => item.id === value));
          }}
        >
          <SelectTrigger id="pi-provider" className="w-full">
            <SelectValue placeholder="选择模型服务" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__custom">添加第三方聚合 / 自定义 API…</SelectItem>
            {configuration?.providers.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
                {item.configured ? " · 已配置" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsField>
      {custom && (
        <>
          <SettingsField
            id="pi-service-name"
            label="服务名称"
            hint="用于区分不同聚合服务，例如「我的聚合 API」。"
          >
            <Input
              id="pi-service-name"
              value={serviceName}
              disabled={disabled}
              onChange={(e) => {
                setServiceName(e.target.value);
                setNotice("");
              }}
            />
          </SettingsField>
          <SettingsField
            id="pi-url"
            label="API 基础地址"
            hint="填写服务提供的 Base URL，通常以 /v1 结尾；不要填 /chat/completions。"
          >
            <Input
              id="pi-url"
              value={baseUrl}
              disabled={disabled}
              placeholder="https://api.example.com/v1"
              autoComplete="off"
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setRemoteModels([]);
                setManual(true);
                setNotice("");
              }}
            />
          </SettingsField>
        </>
      )}
      <SettingsField
        id="pi-key"
        label="API Key"
        hint={
          custom
            ? "填写该聚合服务的 Key。留空保留原地址的凭据；无需鉴权的本地服务可以留空。"
            : "留空保留该服务已有凭据，也可使用服务端已配置的环境变量。"
        }
      >
        <Input
          id="pi-key"
          type="password"
          value={apiKey}
          disabled={disabled || clearApiKey}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          onChange={(e) => {
            setApiKey(e.target.value);
            setRemoteModels([]);
            setNotice("");
          }}
        />
      </SettingsField>
      {selected?.configured && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={clearApiKey}
            disabled={disabled}
            onChange={(e) => {
              setClearApiKey(e.target.checked);
              setApiKey("");
              setRemoteModels([]);
              setNotice("");
            }}
          />
          清除该服务已保存的凭据
        </label>
      )}
      <SettingsField
        id="pi-model"
        label="模型"
        hint={
          custom
            ? "可读取聚合服务的 /models 列表；未提供列表时，直接填写模型 ID。"
            : "选择 Pi 模型目录中的模型。"
        }
      >
        <div className="flex gap-2">
          {useSelect ? (
            <Select value={model} disabled={disabled} onValueChange={chooseModel}>
              <SelectTrigger id="pi-model" className="min-w-0 flex-1">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent>
                {options.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="pi-model"
              value={model}
              disabled={disabled}
              autoComplete="off"
              placeholder="填写完整模型 ID"
              onChange={(e) => {
                setModel(e.target.value);
                setNotice("");
              }}
            />
          )}
          {custom && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled || !baseUrl.trim()}
              onClick={loadModels}
            >
              {busy === "models" ? "读取中…" : "读取模型"}
            </Button>
          )}
        </div>
        {options.length > 0 && (
          <button
            type="button"
            className="text-muted-foreground text-xs underline underline-offset-4"
            disabled={disabled}
            onClick={() => {
              setManual(useSelect);
              const first = options[0];
              if (!useSelect && first && !options.some((item) => item.id === model))
                chooseModel(first.id);
            }}
          >
            {useSelect ? "手动填写模型 ID" : "从列表选择"}
          </button>
        )}
      </SettingsField>
      {custom && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm">高级配置</summary>
          <div className="mt-3 space-y-3">
            <SettingsField
              id="pi-protocol"
              label="接口协议"
              hint="聚合服务通常使用 OpenAI Chat Completions；以服务文档为准。"
            >
              <Select
                value={protocol}
                disabled={disabled}
                onValueChange={(value) => {
                  setProtocol(value as typeof protocol);
                  setRemoteModels([]);
                  setNotice("");
                }}
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
              <SettingsField id="pi-context" label="上下文长度" hint="按模型实际限制填写。">
                <Input
                  id="pi-context"
                  type="number"
                  min={1}
                  value={contextWindow}
                  disabled={disabled}
                  onChange={(e) => {
                    setContextWindow(Number(e.target.value));
                    setNotice("");
                  }}
                />
              </SettingsField>
              <SettingsField id="pi-max-tokens" label="最大输出 Token" hint="不能超过上下文长度。">
                <Input
                  id="pi-max-tokens"
                  type="number"
                  min={1}
                  value={maxTokens}
                  disabled={disabled}
                  onChange={(e) => {
                    setMaxTokens(Number(e.target.value));
                    setNotice("");
                  }}
                />
              </SettingsField>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={supportsImages}
                disabled={disabled}
                onChange={(event) => {
                  setSupportsImages(event.target.checked);
                  setNotice("");
                }}
              />
              此模型支持图片输入
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={reasoning}
                disabled={disabled}
                onChange={(event) => {
                  setReasoning(event.target.checked);
                  setNotice("");
                }}
              />
              此模型支持思考程度调整
            </label>
            <p className="text-muted-foreground text-xs">
              图片输入仅适用于视觉模型，思考调整需服务支持推理参数。视频和音频不作为对话输入。
            </p>
            <p className="text-muted-foreground text-xs">
              新模型的初始值仅作起点，模型列表不一定提供这些限制。
            </p>
          </div>
        </details>
      )}
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
