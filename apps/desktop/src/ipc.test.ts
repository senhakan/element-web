/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { expect, describe, it, vi } from "vitest";
import { ipcMain, net, type IpcMainInvokeEvent } from "electron";

import { getConfig } from "./config.js";

vi.mock("electron", () => ({
    ipcMain: {
        on: vi.fn(),
        once: vi.fn(),
        handle: vi.fn(),
    },
    net: {
        fetch: vi.fn(),
    },
}));

vi.mock("./config.js");

describe("getConfig", () => {
    it("should call config.getConfig and return the value", async () => {
        const config = { brand: "BRAND", help_url: "HELP_URL", web_base_url: "WEB_BASE_URL" };
        vi.mocked(getConfig).mockReturnValue(config);

        await import("./ipc.js");

        const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "getConfig")?.[1];
        expect(handler).toBeDefined();

        expect(handler!(new Event("test") as unknown as IpcMainInvokeEvent)).toStrictEqual(config);
        expect(getConfig).toHaveBeenCalled();
    });
});

describe("acloudSoftphoneApiGet", () => {
    it("rejects an empty access token without making a request", async () => {
        await import("./ipc.js");

        const handler = vi
            .mocked(ipcMain.handle)
            .mock.calls.find(([channel]) => channel === "acloudSoftphoneApiGet")?.[1];
        expect(handler).toBeDefined();

        await expect(handler!(new Event("test") as unknown as IpcMainInvokeEvent, "")).resolves.toStrictEqual({
            status: 401,
            body: { error: "matrix_session_missing" },
        });
        expect(net.fetch).not.toHaveBeenCalled();
    });

    it("forwards the token only to the fixed SIP profile endpoint", async () => {
        vi.mocked(net.fetch).mockResolvedValue(
            new Response(JSON.stringify({ sipEnabled: true, sipExtension: "6221" }), { status: 200 }),
        );
        await import("./ipc.js");

        const handler = vi
            .mocked(ipcMain.handle)
            .mock.calls.find(([channel]) => channel === "acloudSoftphoneApiGet")?.[1];
        expect(handler).toBeDefined();

        await expect(handler!(new Event("test") as unknown as IpcMainInvokeEvent, "test-token")).resolves.toStrictEqual(
            {
                status: 200,
                body: { sipEnabled: true, sipExtension: "6221" },
            },
        );
        expect(net.fetch).toHaveBeenCalledWith(
            "https://im.acloud.tr/softphone/api/sip-profile",
            expect.objectContaining({
                method: "GET",
                headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
            }),
        );
    });
});
