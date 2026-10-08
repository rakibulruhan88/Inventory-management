import { useState, type ReactNode, type ChangeEvent } from "react";
import { ImagePlus, Link as LinkIcon, Upload, X, Globe, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { paymentOptions, type SettingsFormData } from "./settings-model";

export function SettingsField({ id, label, hint, error, children, className = "", required = false }: { id: string; label: string; hint?: string; error?: string; children: ReactNode; className?: string; required?: boolean }) {
  return <div className={`settings-field ${className}`}><label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>{children}{hint && <p className="settings-hint" id={`${id}-hint`}>{hint}</p>}{error && <p className="settings-field-error" id={`${id}-error`} role="alert">{error}</p>}</div>;
}
export function SettingsPanel({ title, description, tag, children }: { title: string; description: string; tag?: string; children: ReactNode }) {
  return <section className="settings-panel"><header><div><h2>{title}</h2><p>{description}</p></div>{tag && <span className="settings-tag">{tag}</span>}</header><div className="settings-panel-body">{children}</div></section>;
}
export function SettingsLoading() {
  return <div className="settings-loading" role="status"><span className="sr-only">Loading settings…</span>{[0, 1, 2, 3].map((index) => <div key={index} aria-hidden="true"><span /><strong /></div>)}</div>;
}
export function BrandImage({ value, alt, className = "", fallback }: { value?: string | null; alt: string; className?: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState<string | null>(null);
  return value && failed !== value ? <img src={value} alt={alt} className={className} onError={() => setFailed(value)} /> : <>{fallback}</>;
}
export function ImageUpload({ id, label, value, onChange, error, disabled }: { id: string; label: string; value?: string | null; onChange: (value: string | null) => void; error?: string; disabled: boolean }) {
  const [useUrl, setUseUrl] = useState(false);
  const [fileError, setFileError] = useState("");
  const [reading, setReading] = useState(false);
  const readFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileError("");
    if (!["image/png", "image/jpeg", "image/x-icon"].includes(file.type) || file.size > 150000) {
      setFileError("Choose a PNG, JPG or ICO image up to 150 KB.");
      return;
    }
    setReading(true);
    const reader = new FileReader();
    reader.onload = () => { onChange(String(reader.result)); setReading(false); };
    reader.onerror = () => { setFileError("Image could not be read. Try another file."); setReading(false); };
    reader.readAsDataURL(file);
  };
  return <div className="settings-image-field"><div className="settings-image-label"><h3>{label}</h3><span>PNG, JPG or ICO · 150 KB max</span></div><div className="settings-image-upload"><div className={`settings-image-preview ${id === "faviconUrl" ? "is-favicon" : ""}`}><BrandImage value={value} alt={`${label} preview`} fallback={<ImagePlus size={24} aria-hidden="true" />} /></div><div className="settings-image-actions"><label className={`settings-upload-button ${disabled || reading ? "disabled" : ""}`} htmlFor={`settings-${id}-file`}><Upload size={14} aria-hidden="true" />{reading ? "Reading image…" : value ? "Replace image" : "Choose image"}</label><input className="sr-only" type="file" id={`settings-${id}-file`} accept="image/png,image/jpeg,image/x-icon" disabled={disabled || reading} onChange={readFile} /><div><button type="button" onClick={() => setUseUrl(!useUrl)} disabled={disabled}><LinkIcon size={12} aria-hidden="true" />{useUrl ? "Hide URL" : "Use image URL"}</button>{value && <button type="button" disabled={disabled || reading} onClick={() => { onChange(null); setFileError(""); }}><X size={12} aria-hidden="true" />Remove</button>}</div></div></div>{useUrl && <SettingsField id={`settings-${id}-url`} label="Image URL" hint={value?.startsWith("data:") ? "An uploaded image is selected. Paste a URL to replace it." : "Use a direct http or https image link."}><Input id={`settings-${id}-url`} type="url" placeholder="https://…" value={value?.startsWith("data:") ? "" : value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value || null)} /></SettingsField>}{(error || fileError) && <p role="alert" className="settings-field-error">{fileError || error}</p>}</div>;
}
export function StorePreview({ values, dirty }: { values: Partial<SettingsFormData>; dirty: boolean }) {
  const color = /^#[0-9a-fA-F]{6}$/.test(values.brandAccent ?? "") ? values.brandAccent : "var(--primary)";
  return <aside className="settings-preview" aria-label="Live store branding preview"><div className="settings-preview-caption"><span>Store preview</span><span>{dirty ? "Unsaved changes" : "Saved branding"}</span></div><div className="settings-preview-store"><div className="settings-preview-logo"><BrandImage value={values.logoUrl} alt="Store logo preview" fallback={<span style={{ color }}>{(values.storeName?.trim() || "Afia").slice(0, 1).toUpperCase()}</span>} /></div><h3>{values.storeName?.trim() || "Your store name"}</h3>{values.storePhone && <p>{values.storePhone}</p>}{values.storeEmail && <p>{values.storeEmail}</p>}{values.storeAddress && <p>{values.storeAddress}</p>}<div className="settings-preview-accent" style={{ background: color }} /></div><div className="settings-browser-preview"><Globe size={13} aria-hidden="true" /><span>Browser tab</span><div><BrandImage value={values.faviconUrl} alt="Browser favicon preview" fallback={<Globe size={14} aria-hidden="true" />} /><strong>{values.storeName?.trim() || "Your store"}</strong></div></div><dl><div><dt>Invoice prefix</dt><dd>{values.invoicePrefix || "—"}</dd></div><div><dt>Payment default</dt><dd>{paymentOptions.find((option) => option.value === values.defaultPaymentMethod)?.label ?? "—"}</dd></div><div><dt>Currency</dt><dd>BDT / {values.currencySymbol || "৳"}</dd></div></dl></aside>;
}
export function SaveStatus({ dirty, saving, savedAt }: { dirty: boolean; saving: boolean; savedAt: number | null }) {
  return <div className="settings-save-status" role="status"><span className={dirty ? "is-dirty" : "is-saved"}>{dirty ? <span className="settings-unsaved-dot" /> : <Check size={15} aria-hidden="true" />}{saving ? "Saving store settings…" : dirty ? "Unsaved store changes" : savedAt ? "Store settings saved" : "All store changes saved"}</span><p>{dirty ? "Save to apply your changes across the store." : savedAt ? `Saved at ${new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Dhaka" }).format(savedAt)}` : "Your current store preferences are up to date."}</p></div>;
}
export function SettingsRetry({ message, retry, busy }: { message: string; retry: () => void; busy: boolean }) {
  return <div className="settings-feedback" role="alert"><h2>Settings could not be loaded</h2><p>{message}</p><Button variant="outline" onClick={retry} disabled={busy}>{busy ? "Retrying…" : "Try again"}</Button></div>;
}
