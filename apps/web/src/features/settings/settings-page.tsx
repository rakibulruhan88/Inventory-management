import { useAuth } from "@/features/auth/auth-context";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { useSearchParams } from "react-router-dom";
import { Check, ChevronRight, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getSettings, updateSettings } from "@/lib/api";
import { AccountSettings, SettingsSignOut } from "./account-settings";
import { AppSettings } from "./app-settings";
import { SaveStatus, SettingsLoading, SettingsRetry, StorePreview } from "./settings-components";
import { StoreSettingsPanels } from "./settings-store-panels";
import { settingsSchema, settingsSections, type SettingsFormData, type SettingsSectionId } from "./settings-model";
import "./settings.css";

export function SettingsPage() {
  const owner = useAuth().user?.role === "OWNER";
  const availableSections = settingsSections.filter(item => owner || ["account", "app"].includes(item.id));
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const section: SettingsSectionId = availableSections.find((item) => item.id === params.get("section"))?.id ?? (owner ? "business" : "account");
  const active = settingsSections.find((item) => item.id === section)!;
  const storeSection = !["account", "app"].includes(section);
  const query = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const form = useForm<SettingsFormData>({ resolver: zodResolver(settingsSchema), mode: "onBlur" });
  const watched = useWatch({ control: form.control });
  const dirty = form.formState.isDirty;
  const dirtyFields = form.formState.dirtyFields;
  const [accountDirty, setAccountDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [focusField, setFocusField] = useState<keyof SettingsFormData | null>(null);
  const initialized = useRef(false);
  const sectionHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Background refetches must not overwrite changes being edited.
    if (query.data && (!initialized.current || !dirty)) {
      form.reset(query.data as SettingsFormData);
      initialized.current = true;
    }
  }, [query.data, dirty, form]);
  useEffect(() => {
    if (!dirty && !accountDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, accountDirty]);
  useEffect(() => {
    if (!focusField) return;
    if (focusField === "logoUrl" || focusField === "faviconUrl") sectionHeading.current?.focus();
    else form.setFocus(focusField);
    setFocusField(null);
  }, [focusField, section, form]);
  const save = useMutation({ mutationFn: updateSettings, onSuccess: (result) => {
    qc.setQueryData(["settings"], result);
    form.reset(result as SettingsFormData);
    document.documentElement.style.setProperty("--brand-accent", result.brandAccent);
    setSavedAt(Date.now());
    void qc.invalidateQueries({ queryKey: ["inventory"] });
    void qc.invalidateQueries({ queryKey: ["inventory-summary"] });
    toast.success("Store settings saved");
  }, onError: (error: Error) => toast.error(error.message) });
  const chooseSection = (id: SettingsSectionId) => { const next = new URLSearchParams(params); next.set("section", id); setParams(next, { replace: true }); };
  const onInvalid = (errors: FieldErrors<SettingsFormData>) => {
    const first = Object.keys(errors)[0] as keyof SettingsFormData;
    const target = settingsSections.find((item) => (item.fields as readonly string[]).includes(first));
    if (target) chooseSection(target.id);
    setFocusField(first);
    toast.error("Review the highlighted settings before saving.");
  };
  const discard = () => { if (query.data) form.reset(query.data as SettingsFormData); save.reset(); };
  const changedSections = settingsSections.filter((item) => item.fields.some((field) => dirtyFields[field])).length;

  return <div className="settings-page">
    <header className="settings-page-header"><div><p className="settings-eyebrow">AFIA LEATHER / PREFERENCES</p><h1>Settings</h1><p>Your store, your defaults, your account.</p></div><span className={`settings-header-status ${dirty || accountDirty ? "pending" : ""}`}><i />{dirty || accountDirty ? "Changes pending" : "Store preferences"}</span></header>
    <div className="settings-workspace"><aside className="settings-sidebar"><div className="settings-sidebar-caption">WORKSPACE SETTINGS</div><nav aria-label="Settings sections">{availableSections.map(({ id, title, description, icon: Icon, fields }) => {
      const changed = fields.some((field) => dirtyFields[field]) || (id === "account" && accountDirty);
      const errors = fields.some((field) => form.formState.errors[field]);
      return <button type="button" key={id} className={section === id ? "active" : ""} aria-current={section === id ? "page" : undefined} onClick={() => chooseSection(id)}><Icon size={17} aria-hidden="true" /><span><strong>{title}</strong><small>{description}</small></span>{errors ? <i className="settings-section-dot error" aria-label="Has validation errors" /> : changed ? <i className="settings-section-dot" aria-label="Has unsaved changes" /> : <ChevronRight size={13} aria-hidden="true" />}</button>;
    })}</nav><div className="settings-sidebar-note"><Check size={16} aria-hidden="true" /><p>Store settings are shared across your workspace. Account changes apply to your login.</p></div></aside>
      <div className="settings-content"><div className="settings-section-heading"><div><p>Preferences / {active.title}</p><h2 ref={sectionHeading} tabIndex={-1}>{active.title}</h2></div>{storeSection && <span className="settings-edit-tag">{dirty ? `${changedSections} ${changedSections === 1 ? "section" : "sections"} changed` : "Store settings"}</span>}</div>
        <div className={`settings-content-grid ${!storeSection ? "wide" : ""}`}><div className="settings-edit-content">
          <form id="store-settings-form" noValidate onSubmit={form.handleSubmit((values) => { if (!save.isPending && dirty) save.mutate(values); }, onInvalid)}>
            {storeSection && (query.isError ? <SettingsRetry message={query.error.message} retry={() => void query.refetch()} busy={query.isFetching} /> : query.isPending || !initialized.current ? <SettingsLoading /> : <fieldset disabled={save.isPending}><StoreSettingsPanels section={section} form={form} watched={watched} busy={save.isPending} /></fieldset>)}
          </form>
          <div hidden={section !== "account"}><AccountSettings active={section === "account"} storeDirty={dirty} onDirtyChange={setAccountDirty} />{section === "account" && <SettingsSignOut dirty={dirty || accountDirty} />}</div>
          <div hidden={section !== "app"}>{section === "app" && <AppSettings dirty={dirty || accountDirty} />}</div>
          {save.isError && <div className="settings-save-error" role="alert"><strong>Store settings could not be saved</strong><p>{save.error.message}</p><span>Your edits are still here. Try saving again.</span></div>}
        </div>{storeSection && query.data && !query.isError && <StorePreview values={watched} dirty={dirty} />}</div>
        {(storeSection || dirty) && query.data && !query.isError && <div className="settings-save-bar"><SaveStatus dirty={dirty} saving={save.isPending} savedAt={savedAt} /><div><Button type="button" variant="outline" onClick={discard} disabled={!dirty || save.isPending}><RotateCcw size={14} aria-hidden="true" />Discard</Button><Button type="submit" form="store-settings-form" disabled={!dirty || save.isPending}><Save size={15} aria-hidden="true" />{save.isPending ? "Saving…" : "Save store settings"}</Button></div></div>}
      </div>
    </div>
  </div>;
}
