import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ProviderManagerComponent } from "../src/modes/interactive/components/provider-manager.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("provider manager", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	it("lists custom providers and does not reveal a stored API key while editing", () => {
		const manager = new ProviderManagerComponent({
			providers: [
				{
					id: "deepseek-local",
					api: "openai-completions",
					baseUrl: "https://api.example.test/v1",
					apiKey: "stored-secret",
					models: [{ id: "deepseek-v4-flash", contextWindow: 1_000_000 }],
				},
			],
			onSave: vi.fn(async () => {}),
			onCancel: vi.fn(),
			requestRender: vi.fn(),
		});

		expect(stripAnsi(manager.render(120).join("\n"))).toContain("deepseek-local");
		manager.handleInput("\x1b[B");
		manager.handleInput("\r");
		manager.handleInput("\x1b[B");
		manager.handleInput("\r");
		manager.handleInput("\r");
		const apiKeyStep = stripAnsi(manager.render(120).join("\n"));
		expect(apiKeyStep).toContain("Edit deepseek-local");
		expect(apiKeyStep).toContain("OpenAI Responses");
		expect(apiKeyStep).toContain("Leave blank to keep the current key");
		expect(apiKeyStep).not.toContain("stored-secret");
	});

	it("collects all fields for a new provider", async () => {
		const onSave = vi.fn(async () => {});
		const manager = new ProviderManagerComponent({
			providers: [],
			onSave,
			onCancel: vi.fn(),
			requestRender: vi.fn(),
		});

		manager.handleInput("deepseek-local");
		manager.handleInput("\r");
		manager.handleInput("\r");
		manager.handleInput("https://api.example.test/v1");
		manager.handleInput("\r");
		manager.handleInput("secret-key");
		manager.handleInput("\r");
		manager.handleInput("deepseek-v4-flash[1m],deepseek-v4-pro[128k]");
		manager.handleInput("\r");
		expect(stripAnsi(manager.render(120).join("\n"))).toContain("Review provider");
		manager.handleInput("\r");

		await vi.waitFor(() => {
			expect(onSave).toHaveBeenCalledWith({
				id: "deepseek-local",
				api: "openai-completions",
				baseUrl: "https://api.example.test/v1",
				apiKey: "secret-key",
				models: "deepseek-v4-flash[1m],deepseek-v4-pro[128k]",
			});
		});
	});

	it("moves between fields without losing values", () => {
		const manager = new ProviderManagerComponent({
			providers: [],
			onSave: vi.fn(async () => {}),
			onCancel: vi.fn(),
			requestRender: vi.fn(),
		});

		manager.handleInput("local");
		manager.handleInput("\t");
		manager.handleInput("\t");
		manager.handleInput("https://api.example.test/v1");
		manager.handleInput("\x1b[A");

		const form = stripAnsi(manager.render(120).join("\n"));
		expect(form).toContain("Provider ID");
		expect(form).toContain("local");
	});
});
