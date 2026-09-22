import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ProviderConfigInput } from "./provider-composer.ts";

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
const PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u;
export const DEFAULT_CUSTOM_PROVIDER_API = "openai-completions" as const;
export const CUSTOM_PROVIDER_APIS = ["openai-completions", "openai-responses", "anthropic-messages"] as const;
export type CustomProviderApi = (typeof CUSTOM_PROVIDER_APIS)[number];

type DatabaseSyncConstructor = new (path: string) => DatabaseSync;

export interface CustomProviderModel {
	id: string;
	contextWindow: number;
}

export interface CustomProvider {
	id: string;
	api: CustomProviderApi;
	baseUrl: string;
	apiKey: string;
	models: readonly CustomProviderModel[];
}

export interface CustomProviderDraft {
	id: string;
	api?: CustomProviderApi;
	baseUrl: string;
	apiKey: string;
	models: string;
}

export interface CustomProviderStore {
	list(): readonly CustomProvider[];
	write(provider: CustomProvider): void;
}

interface CustomProviderRow {
	provider_id: string;
	api: string;
	base_url: string;
	api_key: string;
	models_json: string;
}

export function isCustomProviderApi(value: string | undefined): value is CustomProviderApi {
	return value !== undefined && (CUSTOM_PROVIDER_APIS as readonly string[]).includes(value);
}

function parseContextWindow(value: string | undefined, modelId: string): number {
	if (!value) return DEFAULT_CONTEXT_WINDOW;
	const match = /^(\d+(?:\.\d+)?)([km])$/iu.exec(value);
	if (!match)
		throw new Error(`Model "${modelId}" has invalid context size "${value}". Use values such as 128k or 1m.`);
	const amount = Number(match[1]);
	const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : 1_000;
	const contextWindow = amount * multiplier;
	if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) {
		throw new Error(`Model "${modelId}" has invalid context size "${value}".`);
	}
	return contextWindow;
}

export function parseCustomProviderModels(value: string): CustomProviderModel[] {
	const entries = value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (entries.length === 0) throw new Error("At least one model is required.");

	const models: CustomProviderModel[] = [];
	const ids = new Set<string>();
	for (const entry of entries) {
		const match = /^([^[\]]+?)(?:\[([^[\]]+)\])?$/u.exec(entry);
		if (!match) throw new Error(`Invalid model "${entry}". Use model-id[128k] or model-id[1m].`);
		const id = match[1]?.trim() ?? "";
		if (!id) throw new Error(`Invalid model "${entry}".`);
		if (ids.has(id)) throw new Error(`Duplicate model "${id}".`);
		ids.add(id);
		models.push({ id, contextWindow: parseContextWindow(match[2]?.trim(), id) });
	}
	return models;
}

function formatContextWindow(contextWindow: number): string {
	if (contextWindow >= 1_000_000) return `${contextWindow / 1_000_000}m`;
	return `${contextWindow / 1_000}k`;
}

export function formatCustomProviderModels(models: readonly CustomProviderModel[]): string {
	return models.map((model) => `${model.id}[${formatContextWindow(model.contextWindow)}]`).join(",");
}

export function normalizeCustomProvider(draft: CustomProviderDraft): CustomProvider {
	const id = draft.id.trim().toLowerCase();
	if (!PROVIDER_ID_PATTERN.test(id)) {
		throw new Error("Provider id must use lowercase letters, numbers, dots, underscores, or hyphens.");
	}
	const baseUrl = draft.baseUrl.trim().replace(/\/+$/u, "");
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(baseUrl);
	} catch {
		throw new Error("Base URL must be a valid HTTP or HTTPS URL.");
	}
	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
		throw new Error("Base URL must use HTTP or HTTPS.");
	}
	const apiKey = draft.apiKey.trim();
	if (!apiKey) throw new Error("API key is required.");
	const api = draft.api ?? DEFAULT_CUSTOM_PROVIDER_API;
	if (!isCustomProviderApi(api)) throw new Error(`Unsupported custom provider API: ${api}`);
	return { id, api, baseUrl, apiKey, models: parseCustomProviderModels(draft.models) };
}

export function customProviderToConfig(provider: CustomProvider): ProviderConfigInput {
	return {
		name: provider.id,
		baseUrl: provider.baseUrl,
		apiKey: provider.apiKey,
		api: provider.api,
		models: provider.models.map((model) => ({
			id: model.id,
			name: model.id,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: model.contextWindow,
			maxTokens: Math.min(DEFAULT_MAX_TOKENS, model.contextWindow),
		})),
	};
}

function isCustomProviderModel(value: unknown): value is CustomProviderModel {
	return (
		typeof value === "object" &&
		value !== null &&
		"id" in value &&
		typeof value.id === "string" &&
		"contextWindow" in value &&
		typeof value.contextWindow === "number" &&
		Number.isSafeInteger(value.contextWindow) &&
		value.contextWindow > 0
	);
}

function rowToProvider(row: CustomProviderRow): CustomProvider {
	const parsed: unknown = JSON.parse(row.models_json);
	if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isCustomProviderModel)) {
		throw new Error(`Custom provider "${row.provider_id}" has invalid model data.`);
	}
	return normalizeCustomProvider({
		id: row.provider_id,
		api: isCustomProviderApi(row.api) ? row.api : DEFAULT_CUSTOM_PROVIDER_API,
		baseUrl: row.base_url,
		apiKey: row.api_key,
		models: formatCustomProviderModels(parsed),
	});
}

export class InMemoryCustomProviderStore implements CustomProviderStore {
	private readonly providers = new Map<string, CustomProvider>();

	list(): readonly CustomProvider[] {
		return [...this.providers.values()].map((provider) => structuredClone(provider));
	}

	write(provider: CustomProvider): void {
		this.providers.set(provider.id, structuredClone(provider));
	}
}

export class SqliteCustomProviderStore implements CustomProviderStore {
	private readonly path: string;
	private database: DatabaseSync | undefined;

	constructor(path: string) {
		this.path = path;
	}

	private getDatabase(): DatabaseSync {
		if (this.database) return this.database;
		if (this.path !== ":memory:") {
			mkdirSync(dirname(this.path), { recursive: true });
			if (!existsSync(this.path)) {
				try {
					closeSync(openSync(this.path, "wx", 0o600));
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				}
			}
		}
		const sqlite = process.getBuiltinModule("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor };
		const database = new sqlite.DatabaseSync(this.path);
		database.exec("PRAGMA busy_timeout = 5000");
		database.exec(`
			CREATE TABLE IF NOT EXISTS custom_providers (
				provider_id TEXT PRIMARY KEY,
				api TEXT NOT NULL DEFAULT '${DEFAULT_CUSTOM_PROVIDER_API}',
				base_url TEXT NOT NULL,
				api_key TEXT NOT NULL,
				models_json TEXT NOT NULL,
				updated_at TEXT NOT NULL
			) STRICT
		`);
		const columns = database.prepare("PRAGMA table_info(custom_providers)").all() as unknown as Array<{
			name: string;
		}>;
		if (!columns.some((column) => column.name === "api")) {
			database.exec(
				`ALTER TABLE custom_providers ADD COLUMN api TEXT NOT NULL DEFAULT '${DEFAULT_CUSTOM_PROVIDER_API}'`,
			);
		}
		if (this.path !== ":memory:" && process.platform !== "win32") chmodSync(this.path, 0o600);
		this.database = database;
		return database;
	}

	list(): readonly CustomProvider[] {
		if (this.path !== ":memory:" && !existsSync(this.path)) return [];
		const rows = this.getDatabase()
			.prepare("SELECT provider_id, api, base_url, api_key, models_json FROM custom_providers ORDER BY provider_id")
			.all() as unknown as CustomProviderRow[];
		return rows.map(rowToProvider);
	}

	write(provider: CustomProvider): void {
		this.getDatabase()
			.prepare(`
				INSERT INTO custom_providers (provider_id, api, base_url, api_key, models_json, updated_at)
				VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT(provider_id) DO UPDATE SET
					api = excluded.api,
					base_url = excluded.base_url,
					api_key = excluded.api_key,
					models_json = excluded.models_json,
					updated_at = excluded.updated_at
			`)
			.run(
				provider.id,
				provider.api,
				provider.baseUrl,
				provider.apiKey,
				JSON.stringify(provider.models),
				new Date().toISOString(),
			);
	}

	close(): void {
		this.database?.close();
		this.database = undefined;
	}
}
