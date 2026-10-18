"use client";

import { type AppSettings, appSettingsSchema, DEFAULT_APP_SETTINGS } from "@aigc-flow/shared";
import { Settings } from "lucide-react";
import { type FormEvent, useState } from "react";
import { SettingsField } from "@/components/settings-field";
import { SettingsPiSection } from "@/components/settings-pi-section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";

/** 内网服务分类下的四个纯文本设置项，新增同类项在这里加一行 */
const SERVICE_FIELDS: Array<{
  key: keyof AppSettings;
  label: string;
  placeholder: string;
  hint: string;
}> = [
  {
    key: "imageUploadUrl",
    label: "图像 / 视频上传接口",
    placeholder: "http://<内网主机>:<端口>/api/upload",
    hint: "图片和视频素材经服务端转发上传到这里，填完整接口地址。",
  },
  {
    key: "audioUploadUrl",
    label: "音频上传接口",
    placeholder: "http://<内网主机>:<端口>/api/upload-media",
    hint: "音频素材的上传接口，填完整接口地址。",
  },
  {
    key: "generateUrl",
    label: "AIGC 生成接口",
    placeholder: "http://<内网主机>:<端口>/aigc",
    hint: "图像 / 视频生成（/aigc）走这里，注意端口和上传不同。",
  },
  {
    key: "reqFrom",
    label: "请求来源标识（req_from）",
    placeholder: "v_zhangsan",
    hint: "上传和生成接口都要求携带的个人标识，不填两边都用不了。",
  },
];

/**
 * 内网服务保存在 SQLite，模型连接由 Pi 独立管理。
 */
export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  /** 校验失败时定位到具体字段；网络类错误挂在 form 上 */
  const [error, setError] = useState<{ field: string; message: string } | null>(null);

  const patch = (next: Partial<AppSettings>) => setValues((current) => ({ ...current, ...next }));

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    setError(null);
    if (!next) return;

    setLoading(true);
    api.api.settings
      .$get()
      .then((res) => res.json())
      .then((data) => setValues(data))
      .catch(() => setError({ field: "form", message: "读取设置失败，确认 server 已启动" }))
      .finally(() => setLoading(false));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    // 校验用的是和服务端同一份 shared schema，两边判断永远一致。
    const parsed = appSettingsSchema.safeParse(values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = String(issue?.path[0] ?? "form");
      setError({ field, message: issue?.message ?? "输入不正确" });
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await api.api.settings.$put({ json: parsed.data });
      if (!res.ok) {
        setError({ field: "form", message: "保存失败，请检查输入" });
        return;
      }
      setValues(await res.json());
      setOpen(false);
    } catch {
      setError({ field: "form", message: "连不上服务，确认 server 已启动" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="设置">
              <Settings />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">设置</TooltipContent>
      </Tooltip>

      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>外部服务的连接配置，保存在服务端，所有人共享。</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="pi">
          <TabsList>
            <TabsTrigger value="pi">Pi 模型</TabsTrigger>
            <TabsTrigger value="service">内网服务</TabsTrigger>
          </TabsList>
          <TabsContent value="pi" className="max-h-[65vh] overflow-y-auto pr-1">
            <SettingsPiSection />
          </TabsContent>
          <TabsContent value="service">
            <form onSubmit={handleSubmit}>
              <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                {SERVICE_FIELDS.map(({ key, label, placeholder, hint }) => (
                  <SettingsField
                    key={key}
                    id={`setting-${key}`}
                    label={label}
                    hint={hint}
                    error={error?.field === key ? error.message : undefined}
                  >
                    <Input
                      id={`setting-${key}`}
                      value={values[key]}
                      onChange={(event) => patch({ [key]: event.target.value })}
                      placeholder={placeholder}
                      disabled={loading}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </SettingsField>
                ))}
              </div>

              <DialogFooter className="items-center gap-3 pt-6">
                {error?.field === "form" && (
                  <p className="text-destructive text-sm">{error.message}</p>
                )}
                <Button type="submit" disabled={loading || saving}>
                  {saving ? "保存中…" : "保存"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
