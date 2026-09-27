import { describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { InMemoryCustomProviderStore } from "../src/core/custom-provider-store.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { InMemoryCodingAgentModelsStore } from "../src/core/models-store.ts";

describe("ModelRuntime custom providers", () => {
	it("makes custom provider models available when a stored credential has an empty key", async () => {
		// A leftover auth.json entry with an empty key must not shadow the key
		// configured through /provider; otherwise checkAuth fails and the models
		// never show up in the /model selector.
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory({ "deepseek-local": { type: "api_key", key: "" } }),
			modelsPath: null,
			modelsStore: new InMemoryCodingAgentModelsStore(),
			customProviderStore: new InMemoryCustomProviderStore(),
			allowModelNetwork: false,
		});

		await runtime.saveCustomProvider({
			id: "deepseek-local",
			api: "openai-responses",
			baseUrl: "https://api.example.test/v1",
			apiKey: "configured-key",
			models: "deepseek-v4-flash[1m]",
		});

		expect(await runtime.checkAuth("deepseek-local")).toEqual({ type: "api_key", source: "configured API key" });
		expect(runtime.getAvailableSnapshot()).toEqual(
			expect.arrayContaining([expect.objectContaining({ provider: "deepseek-local", id: "deepseek-v4-flash" })]),
		);
		expect((await runtime.getAuth("deepseek-local"))?.auth.apiKey).toBe("configured-key");
	});

	it("sends an Authorization Bearer header for anthropic-messages providers", async () => {
		// Anthropic-compatible gateways often only read Authorization: Bearer, while
		// the Anthropic client sends the key as x-api-key; requests must carry both.
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory(),
			modelsPath: null,
			modelsStore: new InMemoryCodingAgentModelsStore(),
			customProviderStore: new InMemoryCustomProviderStore(),
			allowModelNetwork: false,
		});

		await runtime.saveCustomProvider({
			id: "longcat",
			api: "anthropic-messages",
			baseUrl: "https://api.example.test/anthropic",
			apiKey: "configured-key",
			models: "LongCat-2.5[1m]",
		});

		const auth = await runtime.getAuth(runtime.getModel("longcat", "LongCat-2.5")!);
		expect(auth?.auth.apiKey).toBe("configured-key");
		expect(auth?.auth.headers).toMatchObject({ Authorization: "Bearer configured-key" });
	});

	it("adds, modifies, and immediately exposes custom models", async () => {
		const store = new InMemoryCustomProviderStore();
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory(),
			modelsPath: null,
			modelsStore: new InMemoryCodingAgentModelsStore(),
			customProviderStore: store,
			allowModelNetwork: false,
		});

		await runtime.saveCustomProvider({
			id: "deepseek-local",
			api: "openai-responses",
			baseUrl: "https://api.example.test/v1",
			apiKey: "secret-key",
			models: "deepseek-v4-flash[1m],deepseek-v4-pro[128k]",
		});

		const flash = runtime.getModel("deepseek-local", "deepseek-v4-flash");
		expect(flash).toMatchObject({
			api: "openai-responses",
			baseUrl: "https://api.example.test/v1",
			contextWindow: 1_000_000,
		});
		expect(runtime.getAvailableSnapshot()).toEqual(
			expect.arrayContaining([expect.objectContaining({ provider: "deepseek-local", id: "deepseek-v4-flash" })]),
		);
		expect((await runtime.getAuth("deepseek-local"))?.auth.apiKey).toBe("secret-key");

		await runtime.saveCustomProvider({
			id: "deepseek-local",
			baseUrl: "https://new.example.test/v1",
			apiKey: "",
			models: "deepseek-v4-pro[1m]",
		});

		expect(runtime.getModel("deepseek-local", "deepseek-v4-flash")).toBeUndefined();
		expect(runtime.getModel("deepseek-local", "deepseek-v4-pro")).toMatchObject({
			api: "openai-responses",
			baseUrl: "https://new.example.test/v1",
			contextWindow: 1_000_000,
		});
		expect((await runtime.getAuth("deepseek-local"))?.auth.apiKey).toBe("secret-key");
		expect(store.list()[0]?.apiKey).toBe("secret-key");
	});
});
