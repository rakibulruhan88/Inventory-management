import { useEffect, useState } from "react";
import { Check, Globe, Share2, Smartphone, Wifi, WifiOff } from "lucide-react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { SettingsPanel } from "./settings-components";
import { SettingsSignOut } from "./account-settings";

export function AppSettings({ dirty }: { dirty: boolean }) {
  const installed = useMediaQuery("(display-mode: standalone)");
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return <div className="settings-app-sections"><SettingsPanel title="App & device" description="Connection and store preferences for this workspace."><dl className="settings-device-list"><div><dt>Device connection</dt><dd className={online ? "online" : "offline"}>{online ? <Wifi size={15} aria-hidden="true" /> : <WifiOff size={15} aria-hidden="true" />}{online ? "Device online" : "Device offline"}</dd></div><div><dt>App mode</dt><dd>{installed ? <Smartphone size={15} aria-hidden="true" /> : <Globe size={15} aria-hidden="true" />}{installed ? "Home screen app" : "Browser"}</dd></div><div><dt>Business timezone</dt><dd>Asia/Dhaka · Bangladesh</dd></div><div><dt>Store currency</dt><dd>BDT · Bangladeshi Taka</dd></div></dl>{!online && <p className="settings-inline-error" role="status">Your device is offline. Reconnect before saving or loading store records.</p>}</SettingsPanel><SettingsPanel title="Install on iPhone" description="Add a shortcut to open your store from the Home Screen.">{installed ? <div className="settings-info-note"><Check size={16} aria-hidden="true" /><p>This window is already running as a Home Screen app.</p></div> : <><ol className="settings-install-steps">{[
    ["Open in Safari", "Open Afia Leather in Safari on your iPhone."],
    ["Open the Share menu", "Tap Safari’s Share button."],
    ["Add to Home Screen", "Choose Add to Home Screen from the menu."],
    ["Confirm", "Tap Add, then open Afia Leather from your Home Screen."],
  ].map(([title, detail], index) => <li key={title}><span>{index + 1}</span><div><h3>{title}{index === 1 && <Share2 size={14} aria-hidden="true" />}</h3><p>{detail}</p></div></li>)}</ol><p className="settings-hint">Use your usual sign-in details when the app opens.</p></>}</SettingsPanel><SettingsSignOut dirty={dirty} /></div>;
}
