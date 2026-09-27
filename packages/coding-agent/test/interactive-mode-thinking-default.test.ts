import { beforeAll, describe, expect, test, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function makeFakeThis(): {
	session: {
		model: { provider: string; id: string } | undefined;
		thinkingLevel: string;
		setThinkingLevel: ReturnType<typeof vi.fn>;
		getAvailableThinkingLevels: ReturnType<typeof vi.fn>;
	};
	settingsManager: {
		setModelThinkingLevel: ReturnType<typeof vi.fn>;
		getModelThinkingLevel: ReturnType<typeof vi.fn>;
		getDefaultThinkingLevel: ReturnType<typeof vi.fn>;
		setDefaultThinkingLevel: ReturnType<typeof vi.fn>;
	};
	footer: { invalidate: ReturnType<typeof vi.fn> };
	ui: { requestRender: ReturnType<typeof vi.fn> };
	updateEditorBorderColor: ReturnType<typeof vi.fn>;
	showStatus: ReturnType<typeof vi.fn>;
	showError: ReturnType<typeof vi.fn>;
	settingsStore: { global?: string; perModel: Record<string, string> };
} {
	const settingsStore: { global?: string; perModel: Record<string, string> } = { perModel: {} };
	const settingsManager = {
		setModelThinkingLevel: vi.fn((provider: string, modelId: string, level: string) => {
			settingsStore.perModel[`${provider}/${modelId}`] = level;
		}),
		getModelThinkingLevel: vi.fn(
			(provider: string, modelId: string) => settingsStore.perModel[`${provider}/${modelId}`],
		),
		getDefaultThinkingLevel: vi.fn(() => settingsStore.global),
		setDefaultThinkingLevel: vi.fn((level: string) => {
			settingsStore.global = level;
		}),
	};
	const session = {
		model: { provider: "faux", id: "faux-1" },
		thinkingLevel: "off",
		setThinkingLevel: vi.fn(),
		getAvailableThinkingLevels: vi.fn(() => ["off", "low", "high"]),
	};
	return {
		session,
		settingsManager,
		footer: { invalidate: vi.fn() },
		ui: { requestRender: vi.fn() },
		updateEditorBorderColor: vi.fn(),
		showStatus: vi.fn(),
		showError: vi.fn(),
		settingsStore,
	};
}

describe("InteractiveMode.selectThinkingLevel per-model defaults", () => {
	beforeAll(() => initTheme("dark"));

	test("an explicitly selected thinking level becomes the current model's default", () => {
		const fakeThis = makeFakeThis();

		(InteractiveMode as any).prototype.selectThinkingLevel.call(fakeThis, "high", false);

		expect(fakeThis.session.setThinkingLevel).toHaveBeenCalledWith("high", { persist: false });
		expect(fakeThis.settingsManager.setModelThinkingLevel).toHaveBeenCalledWith("faux", "faux-1", "high");
	});

	test("a persisted selection also stores the per-model default", () => {
		const fakeThis = makeFakeThis();

		(InteractiveMode as any).prototype.selectThinkingLevel.call(fakeThis, "low", true);

		expect(fakeThis.session.setThinkingLevel).toHaveBeenCalledWith("low", { persist: true });
		expect(fakeThis.settingsManager.setModelThinkingLevel).toHaveBeenCalledWith("faux", "faux-1", "low");
	});

	test("no model selected does not write a per-model default", () => {
		const fakeThis = makeFakeThis();
		fakeThis.session.model = undefined;

		(InteractiveMode as any).prototype.selectThinkingLevel.call(fakeThis, "low", false);

		expect(fakeThis.settingsManager.setModelThinkingLevel).not.toHaveBeenCalled();
		expect(fakeThis.showStatus).toHaveBeenCalled();
	});
});

describe("InteractiveMode.getCurrentModelDefaultThinkingLevel", () => {
	beforeAll(() => initTheme("dark"));

	test("prefers the current model's stored level over the global default", () => {
		const fakeThis = makeFakeThis();
		fakeThis.settingsStore.global = "high";

		(InteractiveMode as any).prototype.selectThinkingLevel.call(fakeThis, "low", false);

		const resolved = (InteractiveMode as any).prototype.getCurrentModelDefaultThinkingLevel.call(fakeThis);
		expect(resolved).toBe("low");
	});

	test("falls back to the global default when no per-model level is stored", () => {
		const fakeThis = makeFakeThis();
		fakeThis.settingsStore.global = "high";

		const resolved = (InteractiveMode as any).prototype.getCurrentModelDefaultThinkingLevel.call(fakeThis);
		expect(resolved).toBe("high");
	});
});
