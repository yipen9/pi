import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	formatCustomProviderModels,
	normalizeCustomProvider,
	parseCustomProviderModels,
	SqliteCustomProviderStore,
} from "../src/core/custom-provider-store.ts";

describe("custom provider store", () => {
	let tempDir: string | undefined;

	afterEach(() => {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	});

	it("parses k and m context sizes", () => {
		const models = parseCustomProviderModels("deepseek-v4-flash[1m], deepseek-v4-pro[128k], default-size");

		expect(models).toEqual([
			{ id: "deepseek-v4-flash", contextWindow: 1_000_000 },
			{ id: "deepseek-v4-pro", contextWindow: 128_000 },
			{ id: "default-size", contextWindow: 128_000 },
		]);
		expect(formatCustomProviderModels(models)).toBe("deepseek-v4-flash[1m],deepseek-v4-pro[128k],default-size[128k]");
	});

	it("rejects invalid and duplicate model declarations", () => {
		expect(() => parseCustomProviderModels("model[128]")).toThrow("Use values such as 128k or 1m");
		expect(() => parseCustomProviderModels("model[128k],model[1m]")).toThrow('Duplicate model "model"');
	});

	it("does not create an empty database while listing", () => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-custom-providers-"));
		const path = join(tempDir, "providers.sqlite");
		const store = new SqliteCustomProviderStore(path);

		expect(store.list()).toEqual([]);
		expect(existsSync(path)).toBe(false);
		expect(() => store.close()).not.toThrow();
	});

	it("persists providers in SQLite and updates existing rows", () => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-custom-providers-"));
		const path = join(tempDir, "providers.sqlite");
		const store = new SqliteCustomProviderStore(path);
		try {
			store.write(
				normalizeCustomProvider({
					id: "deepseek-local",
					baseUrl: "https://one.example/v1/",
					apiKey: "first-key",
					models: "deepseek-v4-flash[1m]",
				}),
			);
			store.write(
				normalizeCustomProvider({
					id: "deepseek-local",
					baseUrl: "https://two.example/v1",
					apiKey: "second-key",
					models: "deepseek-v4-pro[128k]",
				}),
			);
		} finally {
			store.close();
		}

		const reopened = new SqliteCustomProviderStore(path);
		try {
			expect(reopened.list()).toEqual([
				{
					id: "deepseek-local",
					api: "openai-completions",
					baseUrl: "https://two.example/v1",
					apiKey: "second-key",
					models: [{ id: "deepseek-v4-pro", contextWindow: 128_000 }],
				},
			]);
		} finally {
			reopened.close();
		}
	});
});
