import {
	Container,
	type Focusable,
	getKeybindings,
	Input,
	type SelectItem,
	SelectList,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";
import {
	type CustomProvider,
	type CustomProviderDraft,
	DEFAULT_CUSTOM_PROVIDER_API,
	formatCustomProviderModels,
	isCustomProviderApi,
} from "../../../core/custom-provider-store.ts";
import { getSelectListTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyDisplayText } from "./keybinding-hints.ts";

type ManagerMode = "list" | "edit" | "review";

type ProviderField = "id" | "api" | "baseUrl" | "apiKey" | "models";

interface ProviderFieldDefinition {
	key: ProviderField;
	label: string;
	description: string;
	kind: "input" | "select";
	placeholder?: string;
}

const API_OPTIONS: readonly SelectItem[] = [
	{
		value: "openai-completions",
		label: "OpenAI Chat Completions",
		description: "POST /chat/completions",
	},
	{
		value: "openai-responses",
		label: "OpenAI Responses",
		description: "POST /responses",
	},
	{
		value: "anthropic-messages",
		label: "Anthropic Messages",
		description: "POST /messages",
	},
];

export interface ProviderManagerOptions {
	providers: readonly CustomProvider[];
	initialProviderId?: string;
	onSave: (draft: CustomProviderDraft) => Promise<void>;
	onCancel: () => void;
	requestRender: () => void;
}

export class ProviderManagerComponent extends Container implements Focusable {
	private readonly options: ProviderManagerOptions;
	private mode: ManagerMode;
	private selectedIndex = 0;
	private editing: CustomProvider | undefined;
	private initialProviderId: string | undefined;
	private formValues: string[] = [];
	private formInputs: Input[] = [];
	private apiSelect: SelectList | undefined;
	private activeInputIndex = 0;
	private saving = false;
	private error: string | undefined;
	private statusText: Text | undefined;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.updateInputFocus();
	}

	constructor(options: ProviderManagerOptions) {
		super();
		this.options = options;
		const initialId = options.initialProviderId?.trim().toLowerCase();
		this.editing = initialId ? options.providers.find((provider) => provider.id === initialId) : undefined;
		this.initialProviderId = this.editing ? undefined : initialId;
		this.mode = initialId || options.providers.length === 0 ? "edit" : "list";
		if (this.mode === "edit") this.initializeForm();
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		if (this.mode === "list") this.buildList();
		else if (this.mode === "edit") this.buildForm();
		else this.buildReview();
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.updateInputFocus();
	}

	private buildList(): void {
		this.addChild(new Text(theme.fg("accent", theme.bold("Custom providers")), 1, 0));
		this.addChild(new Text(theme.fg("muted", "OpenAI Chat, OpenAI Responses, or Anthropic Messages"), 1, 0));
		this.addChild(new Spacer(1));
		const items = [undefined, ...this.options.providers];
		for (let index = 0; index < items.length; index++) {
			const provider = items[index];
			const selected = index === this.selectedIndex;
			const prefix = selected ? theme.fg("accent", "→ ") : "  ";
			const label = provider
				? `${provider.id}  ${theme.fg("muted", `${provider.models.length} model${provider.models.length === 1 ? "" : "s"} · ${provider.api} · ${provider.baseUrl}`)}`
				: "+ Add provider";
			this.addChild(new Text(prefix + (selected ? theme.fg("accent", label) : label), 1, 0));
		}
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				theme.fg(
					"dim",
					`${keyDisplayText("tui.select.up")} / ${keyDisplayText("tui.select.down")} to choose · ${keyDisplayText("tui.select.confirm")} to open · ${keyDisplayText("tui.select.cancel")} to close`,
				),
				1,
				0,
			),
		);
	}

	private getFieldDefinitions(): ProviderFieldDefinition[] {
		const fields: ProviderFieldDefinition[] = [];
		if (!this.editing) {
			fields.push({
				key: "id",
				label: "Provider ID",
				description: "Lowercase name used in /model provider/model.",
				kind: "input",
				placeholder: "example-provider",
			});
		}
		fields.push(
			{
				key: "api",
				label: "API protocol",
				description: "Choose the endpoint protocol exposed by this provider.",
				kind: "select",
			},
			{
				key: "baseUrl",
				label: "Base URL",
				description: this.getBaseUrlDescription(),
				kind: "input",
				placeholder: "https://api.example.com/v1",
			},
			{
				key: "apiKey",
				label: "API key",
				description: this.editing ? "Leave blank to keep the current key." : "Required for this provider.",
				kind: "input",
				placeholder: this.editing ? "Leave blank to keep the current key" : "sk-...",
			},
			{
				key: "models",
				label: "Models",
				description: "Comma-separated model IDs. Add [128k] or [1m] to set context size.",
				kind: "input",
				placeholder: "model-a[128k],model-b[1m]",
			},
		);
		return fields;
	}

	private getBaseUrlDescription(): string {
		const api = this.formValues[this.editing ? 0 : 1];
		if (api === "anthropic-messages") {
			return "Provider root URL. The client appends /v1/messages; do not include /messages.";
		}
		return "Provider root URL, usually ending in /v1. Do not include /responses or /chat/completions.";
	}

	private initializeForm(): void {
		const fields = this.getFieldDefinitions();
		this.formValues = fields.map((field) => {
			if (field.key === "id") return this.initialProviderId ?? "";
			if (field.key === "api") return this.editing?.api ?? DEFAULT_CUSTOM_PROVIDER_API;
			if (field.key === "baseUrl") return this.editing?.baseUrl ?? "";
			if (field.key === "models") return this.editing ? formatCustomProviderModels(this.editing.models) : "";
			return "";
		});
		this.activeInputIndex = 0;
	}

	private buildForm(): void {
		this.formInputs = [];
		this.apiSelect = undefined;
		this.statusText = undefined;
		const fields = this.getFieldDefinitions();
		this.activeInputIndex = Math.min(this.activeInputIndex, fields.length - 1);
		const field = fields[this.activeInputIndex];
		if (!field) return;
		this.addChild(
			new Text(theme.fg("accent", theme.bold(this.editing ? `Edit ${this.editing.id}` : "Add provider")), 1, 0),
		);
		this.addChild(new Text(theme.fg("muted", `Step ${this.activeInputIndex + 1} of ${fields.length}`), 1, 0));
		this.addChild(new Spacer(1));

		for (let index = 0; index < this.activeInputIndex; index++) {
			const previousField = fields[index];
			if (!previousField) continue;
			this.addChild(
				new Text(
					theme.fg("success", `✓ ${previousField.label}: ${this.formatFieldSummary(previousField, index)}`),
					1,
					0,
				),
			);
		}

		this.addChild(new Text(theme.fg("accent", theme.bold(field.label)), 1, 0));
		this.addChild(new Text(theme.fg("muted", field.description), 1, 0));
		if (field.kind === "select") {
			const select = new SelectList([...API_OPTIONS], API_OPTIONS.length, getSelectListTheme(), {
				minPrimaryColumnWidth: 26,
				maxPrimaryColumnWidth: 34,
			});
			const selectedIndex = API_OPTIONS.findIndex(
				(option) => option.value === this.formValues[this.activeInputIndex],
			);
			select.setSelectedIndex(selectedIndex >= 0 ? selectedIndex : 0);
			select.onSelectionChange = (item) => {
				if (isCustomProviderApi(item.value)) this.formValues[this.activeInputIndex] = item.value;
			};
			this.apiSelect = select;
			this.addChild(select);
		} else {
			const input = new Input({
				prompt: theme.fg("accent", "› "),
				placeholder: field.placeholder,
				placeholderStyle: (value) => theme.fg("dim", value),
			});
			input.setValue(this.formValues[this.activeInputIndex] ?? "");
			this.addChild(input);
			this.formInputs.push(input);
		}

		this.statusText = new Text(this.error ? theme.fg("error", this.error) : "", 1, 0);
		this.addChild(this.statusText);
		const navigationHint =
			field.kind === "select"
				? `${keyDisplayText("tui.select.up")} / ${keyDisplayText("tui.select.down")} choose · ${keyDisplayText("tui.select.confirm")} / ${keyDisplayText("tui.input.tab")} next`
				: `${keyDisplayText("tui.select.confirm")} continue · ${keyDisplayText("tui.input.tab")} / ${keyDisplayText("tui.select.down")} next`;
		const previousHint = field.kind === "select" ? "Esc back" : `${keyDisplayText("tui.select.up")} previous`;
		this.addChild(
			new Text(
				theme.fg("dim", `${navigationHint} · ${previousHint} · ${keyDisplayText("tui.select.cancel")} back`),
				1,
				0,
			),
		);
	}

	private buildReview(): void {
		const fields = this.getFieldDefinitions();
		this.addChild(new Text(theme.fg("accent", theme.bold("Review provider")), 1, 0));
		this.addChild(
			new Text(
				theme.fg(
					"muted",
					this.saving ? "Saving provider..." : "Press Enter to save, or Esc to edit the previous field.",
				),
				1,
				0,
			),
		);
		this.addChild(new Spacer(1));
		for (let index = 0; index < fields.length; index++) {
			const field = fields[index];
			if (!field) continue;
			this.addChild(
				new Text(`${theme.fg("muted", `${field.label}: `)}${this.formatFieldSummary(field, index)}`, 1, 0),
			);
		}
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				this.error
					? theme.fg("error", this.error)
					: theme.fg(
							"dim",
							`${keyDisplayText("tui.select.confirm")} save · ${keyDisplayText("tui.select.cancel")} edit`,
						),
				1,
				0,
			),
		);
	}

	private formatFieldSummary(field: ProviderFieldDefinition, index: number): string {
		const value = this.formValues[index]?.trim() ?? "";
		if (field.key === "api") return API_OPTIONS.find((option) => option.value === value)?.label ?? value;
		if (field.key === "apiKey") {
			if (this.editing && !value) return "keep current key";
			return value ? "configured" : "not set";
		}
		return value || theme.fg("warning", "not set");
	}

	private updateInputFocus(): void {
		for (let index = 0; index < this.formInputs.length; index++) {
			const input = this.formInputs[index];
			if (input) input.focused = this._focused && this.mode === "edit" && index === 0;
		}
	}

	private beginEdit(provider: CustomProvider | undefined): void {
		this.editing = provider;
		this.initialProviderId = undefined;
		this.mode = "edit";
		this.error = undefined;
		this.initializeForm();
		this.rebuild();
		this.options.requestRender();
	}

	private storeCurrentInput(): void {
		const input = this.formInputs[0];
		if (input) this.formValues[this.activeInputIndex] = input.getValue();
	}

	private draftFromForm(): CustomProviderDraft {
		this.storeCurrentInput();
		const values = new Map(
			this.getFieldDefinitions().map((field, index) => [field.key, this.formValues[index]?.trim() ?? ""] as const),
		);
		const apiValue = values.get("api");
		if (this.editing) {
			return {
				id: this.editing.id,
				api: isCustomProviderApi(apiValue) ? apiValue : this.editing.api,
				baseUrl: values.get("baseUrl") || this.editing.baseUrl,
				apiKey: values.get("apiKey") ?? "",
				models: values.get("models") || formatCustomProviderModels(this.editing.models),
			};
		}
		return {
			id: values.get("id") || this.initialProviderId || "",
			api: isCustomProviderApi(apiValue) ? apiValue : DEFAULT_CUSTOM_PROVIDER_API,
			baseUrl: values.get("baseUrl") ?? "",
			apiKey: values.get("apiKey") ?? "",
			models: values.get("models") ?? "",
		};
	}

	private async save(): Promise<void> {
		if (this.saving) return;
		const draft = this.draftFromForm();
		this.saving = true;
		this.error = undefined;
		this.rebuild();
		this.options.requestRender();
		try {
			await this.options.onSave(draft);
		} catch (error) {
			this.saving = false;
			this.error = error instanceof Error ? error.message : String(error);
			this.rebuild();
			this.options.requestRender();
		}
	}

	private validateCurrentField(): boolean {
		this.storeCurrentInput();
		const field = this.getFieldDefinitions()[this.activeInputIndex];
		const value = this.formValues[this.activeInputIndex]?.trim() ?? "";
		if (!field) return false;
		if (field.key === "id" && !value) this.error = "Provider ID is required.";
		else if (field.key === "api" && !isCustomProviderApi(value)) this.error = "Select an API protocol.";
		else if (field.key === "baseUrl" && !value) this.error = "Base URL is required.";
		else if (field.key === "apiKey" && !value && !this.editing) this.error = "API key is required.";
		else if (field.key === "models" && !value) this.error = "At least one model is required.";
		else {
			this.error = undefined;
			return true;
		}
		this.rebuild();
		this.options.requestRender();
		return false;
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (this.mode === "list") {
			const itemCount = this.options.providers.length + 1;
			if (kb.matches(keyData, "tui.select.up")) {
				this.selectedIndex = this.selectedIndex === 0 ? itemCount - 1 : this.selectedIndex - 1;
				this.rebuild();
			} else if (kb.matches(keyData, "tui.select.down")) {
				this.selectedIndex = (this.selectedIndex + 1) % itemCount;
				this.rebuild();
			} else if (kb.matches(keyData, "tui.select.confirm")) {
				this.beginEdit(this.options.providers[this.selectedIndex - 1]);
			} else if (kb.matches(keyData, "tui.select.cancel")) {
				this.options.onCancel();
			}
			return;
		}

		if (this.mode === "review") {
			if (this.saving) return;
			if (kb.matches(keyData, "tui.select.cancel")) {
				this.mode = "edit";
				this.activeInputIndex = this.getFieldDefinitions().length - 1;
				this.error = undefined;
				this.rebuild();
				this.options.requestRender();
			} else if (kb.matches(keyData, "tui.select.confirm")) {
				void this.save();
			}
			return;
		}

		if (this.saving) return;
		if (kb.matches(keyData, "tui.select.cancel")) {
			if (this.options.providers.length > 0) {
				this.mode = "list";
				this.rebuild();
				this.options.requestRender();
			} else {
				this.options.onCancel();
			}
			return;
		}
		const activeField = this.getFieldDefinitions()[this.activeInputIndex];
		if (
			this.apiSelect &&
			activeField?.key === "api" &&
			(kb.matches(keyData, "tui.select.up") || kb.matches(keyData, "tui.select.down"))
		) {
			this.apiSelect.handleInput(keyData);
			this.options.requestRender();
			return;
		}
		if (kb.matches(keyData, "tui.input.tab") || kb.matches(keyData, "tui.select.down")) {
			if (!this.validateCurrentField()) return;
			this.storeCurrentInput();
			this.activeInputIndex = (this.activeInputIndex + 1) % this.getFieldDefinitions().length;
			this.error = undefined;
			this.rebuild();
			this.options.requestRender();
			return;
		}
		if (kb.matches(keyData, "tui.select.up")) {
			this.storeCurrentInput();
			const fieldCount = this.getFieldDefinitions().length;
			this.activeInputIndex = this.activeInputIndex === 0 ? fieldCount - 1 : this.activeInputIndex - 1;
			this.error = undefined;
			this.rebuild();
			this.options.requestRender();
			return;
		}
		if (kb.matches(keyData, "tui.select.confirm")) {
			if (!this.validateCurrentField()) return;
			if (this.activeInputIndex < this.getFieldDefinitions().length - 1) {
				this.activeInputIndex++;
				this.error = undefined;
				this.rebuild();
			} else {
				this.mode = "review";
				this.error = undefined;
				this.rebuild();
			}
			this.options.requestRender();
			return;
		}
		this.formInputs[0]?.handleInput(keyData);
	}
}
