import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { useDraft } from "../draft";
import { Field, MediaInput, PageHeader, Section } from "../kit";

export function ProfilePage() {
  const { draft, set, setSetting, errors } = useDraft();
  if (!draft) return null;
  return (
    <>
      <PageHeader title="Profile" description="Who you are. Shown on your card and in link previews." />
      <div className="grid gap-5">
        <Section title="Identity">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name" error={errors.name}>
              {(id) => <Input id={id} value={draft.name} maxLength={60} onChange={(e) => set("name", e.target.value)} />}
            </Field>
            <Field label="Handle" hint="e.g. @yourname" error={errors.handle}>
              {(id) => <Input id={id} value={draft.handle} maxLength={40} onChange={(e) => set("handle", e.target.value)} />}
            </Field>
          </div>
          <Field label="Title" hint="A short tagline next to your handle." error={errors.title}>
            {(id) => <Input id={id} value={draft.title} maxLength={80} onChange={(e) => set("title", e.target.value)} />}
          </Field>
          <Field label="Bio" hint={`${draft.bio.length}/500`} error={errors.bio}>
            {(id) => <Textarea id={id} value={draft.bio} maxLength={500} rows={4} onChange={(e) => set("bio", e.target.value)} />}
          </Field>
        </Section>

        <Section title="Images" description="Upload once to the media library and reuse anywhere.">
          <Field label="Avatar" error={errors.avatar_url}>
            {(id) => <MediaInput id={id} value={draft.avatar_url} onChange={(v) => set("avatar_url", v)} />}
          </Field>
          <Field label="Card banner" hint="Shown at the top of the card and faded behind it." error={errors.card_bg_url}>
            {(id) => <MediaInput id={id} value={draft.card_bg_url} onChange={(v) => set("card_bg_url", v)} />}
          </Field>
          <Field label="Page background" hint="Image or MP4/WebM video behind the whole page." error={errors.background_url}>
            {(id) => <MediaInput id={id} value={draft.background_url} onChange={(v) => set("background_url", v)} allowVideo />}
          </Field>
        </Section>

        <Section title="Soundtrack" description="Plays after a visitor clicks the entry screen. Visitors can mute it; the choice is remembered.">
          <Field label="Audio file" error={errors.audio_url}>
            {(id) => <MediaInput id={id} kind="audio" value={draft.audio_url} onChange={(v) => set("audio_url", v)} />}
          </Field>
          <Field label="Track title" error={errors.audio_title}>
            {(id) => <Input id={id} value={draft.audio_title} maxLength={120} onChange={(e) => set("audio_title", e.target.value)} />}
          </Field>
          <Field label={`Default volume · ${draft.settings.default_volume}%`} hint="For first-time visitors. Each visitor's own volume is remembered.">
            {() => (
              <Slider min={0} max={100} step={1} value={[draft.settings.default_volume]} onValueChange={([v]) => setSetting("default_volume", v)} />
            )}
          </Field>
        </Section>
      </div>
    </>
  );
}
