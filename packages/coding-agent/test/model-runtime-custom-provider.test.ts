import { describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { InMemoryCustomProviderStore } from "../src/core/custom-provider-store.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { InMemoryCodingAgentModelsStore } from "../src/core/models-store.ts";

describe("ModelRuntime custom providers", () => {
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
