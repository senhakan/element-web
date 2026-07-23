/*
Copyright 2019-2024 New Vector Ltd.
Copyright 2019 The Matrix.org Foundation C.I.C.
Copyright 2019 Michael Telatynski <7t3chguy@gmail.com>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useContext, useEffect } from "react";
import { HTTPError } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { UserFriendlyError, _t } from "../../../../../languageHandler";
import UserProfileSettings from "../../UserProfileSettings";
import SettingsStore from "../../../../../settings/SettingsStore";
import AccessibleButton from "../../../elements/AccessibleButton";
import DeactivateAccountDialog from "../../../dialogs/DeactivateAccountDialog";
import Modal from "../../../../../Modal";
import { UIFeature } from "../../../../../settings/UIFeature";
import ErrorDialog, { extractErrorMessageFromError } from "../../../dialogs/ErrorDialog";
import ChangePassword from "../../ChangePassword";
import SettingsTab from "../SettingsTab";
import { SettingsSection } from "../../shared/SettingsSection";
import { SettingsSubsection, SettingsSubsectionText } from "../../shared/SettingsSubsection";
import { UserPersonalInfoSettings } from "../../UserPersonalInfoSettings";
import { SDKContext } from "../../../../../contexts/SDKContext.ts";
import SdkConfig from "../../../../../SdkConfig";

interface IProps {
    closeSettingsFn: () => void;
}

interface AccountSectionProps {
    canChangePassword: boolean;
    passwordManagedExternally: boolean;
    passwordPolicyResolved: boolean;
    onPasswordChangeError: (e: Error) => void;
    onPasswordChanged: () => void;
}

const AccountSection: React.FC<AccountSectionProps> = ({
    canChangePassword,
    passwordManagedExternally,
    passwordPolicyResolved,
    onPasswordChangeError,
    onPasswordChanged,
}) => {
    if (!canChangePassword) return <></>;

    return (
        <SettingsSection>
            <SettingsSubsection
                heading={_t("settings|general|account_section")}
                stretchContent
                data-testid="accountSection"
            >
                <SettingsSubsectionText>{_t("settings|general|password_change_section")}</SettingsSubsectionText>
                {passwordManagedExternally && (
                    <SettingsSubsectionText>
                        {_t("settings|general|password_managed_externally")}
                    </SettingsSubsectionText>
                )}
                <ChangePassword
                    rowClassName=""
                    buttonKind="primary"
                    onError={onPasswordChangeError}
                    onFinished={onPasswordChanged}
                    disabled={passwordManagedExternally || !passwordPolicyResolved}
                />
            </SettingsSubsection>
        </SettingsSection>
    );
};

interface ManagementSectionProps {
    onDeactivateClicked: () => void;
}

const ManagementSection: React.FC<ManagementSectionProps> = ({ onDeactivateClicked }) => {
    return (
        <SettingsSection heading={_t("settings|general|deactivate_section")}>
            <SettingsSubsection
                heading={_t("settings|general|account_management_section")}
                data-testid="account-management-section"
                description={_t("settings|general|deactivate_warning")}
            >
                <AccessibleButton onClick={onDeactivateClicked} kind="danger">
                    {_t("settings|general|deactivate_section")}
                </AccessibleButton>
            </SettingsSubsection>
        </SettingsSection>
    );
};

const AccountUserSettingsTab: React.FC<IProps> = ({ closeSettingsFn }) => {
    const [externalAccountManagementUrl, setExternalAccountManagementUrl] = React.useState<string | undefined>();
    const [canMake3pidChanges, setCanMake3pidChanges] = React.useState<boolean>(false);
    const [canSetDisplayName, setCanSetDisplayName] = React.useState<boolean>(false);
    const [canSetAvatar, setCanSetAvatar] = React.useState<boolean>(false);
    const [canChangePassword, setCanChangePassword] = React.useState<boolean>(false);
    const [passwordManagedExternally, setPasswordManagedExternally] = React.useState<boolean>(false);
    const [passwordPolicyResolved, setPasswordPolicyResolved] = React.useState<boolean>(false);

    const sdkContext = useContext(SDKContext);
    const cli = sdkContext.client!;

    useEffect(() => {
        (async () => {
            const capabilities = (await cli.getCapabilities()) ?? {};
            const changePasswordCap = capabilities["m.change_password"];

            // You can change your password so long as the capability isn't explicitly disabled. The implicit
            // behaviour is you can change your password when the capability is missing or has not-false as
            // the enabled flag value.
            const canChangePassword = !changePasswordCap || changePasswordCap["enabled"] !== false;
            const policyEndpoint = SdkConfig.get("enterprise_controls")?.managed_account_policy_endpoint;
            let passwordManagedExternally = false;
            if (policyEndpoint) {
                // Fail closed when an enterprise policy endpoint is configured: a temporary
                // policy lookup failure must not expose password controls for LDAP users.
                passwordManagedExternally = true;
                try {
                    const accessToken = cli.getAccessToken();
                    if (accessToken) {
                        let policyPayload: unknown;
                        if (
                            policyEndpoint === "https://im.acloud.tr/softphone/api/sip-profile" &&
                            typeof window.electron?.acloudSoftphoneApiGet === "function"
                        ) {
                            const result = await window.electron.acloudSoftphoneApiGet(accessToken);
                            if (result.status >= 200 && result.status < 300) {
                                policyPayload = result.body;
                            }
                        } else {
                            const response = await fetch(policyEndpoint, {
                                headers: {
                                    Authorization: `Bearer ${accessToken}`,
                                    Accept: "application/json",
                                },
                                credentials: "omit",
                                cache: "no-store",
                            });
                            if (response.ok) policyPayload = await response.json();
                        }
                        if (policyPayload && typeof policyPayload === "object") {
                            passwordManagedExternally =
                                (policyPayload as { passwordManagedExternally?: boolean }).passwordManagedExternally ===
                                true;
                        }
                    }
                } catch (error) {
                    logger.warn("Failed to load managed account policy", error);
                }
            }

            const authMetadata = await cli.getAuthMetadata().catch(() => {});
            const externalAccountManagementUrl = authMetadata?.account_management_uri;
            // https://spec.matrix.org/v1.7/client-server-api/#m3pid_changes-capability
            // We support as far back as v1.1 which doesn't have m.3pid_changes
            // so the behaviour for when it is missing has to be assume true
            const canMake3pidChanges =
                !capabilities["m.3pid_changes"] || capabilities["m.3pid_changes"].enabled === true;

            const canSetDisplayName =
                !capabilities["m.set_displayname"] || capabilities["m.set_displayname"].enabled === true;
            const canSetAvatar = !capabilities["m.set_avatar_url"] || capabilities["m.set_avatar_url"].enabled === true;

            setCanMake3pidChanges(canMake3pidChanges);
            setCanSetDisplayName(canSetDisplayName);
            setCanSetAvatar(canSetAvatar);
            setExternalAccountManagementUrl(externalAccountManagementUrl);
            setCanChangePassword(canChangePassword);
            setPasswordManagedExternally(passwordManagedExternally);
            setPasswordPolicyResolved(true);
        })();
    }, [cli]);

    const onPasswordChangeError = useCallback((err: Error): void => {
        logger.error("Failed to change password: " + err);

        let underlyingError = err;
        if (err instanceof UserFriendlyError && err.cause instanceof Error) {
            underlyingError = err.cause;
        }

        const errorMessage = extractErrorMessageFromError(
            err,
            _t("settings|general|error_password_change_unknown", {
                stringifiedError: String(err),
            }),
        );

        let errorMessageToDisplay = errorMessage;
        if (underlyingError instanceof HTTPError && underlyingError.httpStatus === 403) {
            errorMessageToDisplay = _t("settings|general|error_password_change_403");
        } else if (underlyingError instanceof HTTPError) {
            errorMessageToDisplay = _t("settings|general|error_password_change_http", {
                errorMessage,
                httpStatus: underlyingError.httpStatus,
            });
        }

        // TODO: Figure out a design that doesn't involve replacing the current dialog
        Modal.createDialog(ErrorDialog, {
            title: _t("settings|general|error_password_change_title"),
            description: errorMessageToDisplay,
        });
    }, []);

    const onPasswordChanged = useCallback((): void => {
        const description = _t("settings|general|password_change_success");
        // TODO: Figure out a design that doesn't involve replacing the current dialog
        Modal.createDialog(ErrorDialog, {
            title: _t("common|success"),
            description,
        });
    }, []);

    const onDeactivateClicked = useCallback((): void => {
        const { finished } = Modal.createDialog(DeactivateAccountDialog);
        finished.then(([success]) => {
            if (success) closeSettingsFn();
        });
    }, [closeSettingsFn]);

    let accountManagementSection: JSX.Element | undefined;
    const isAccountManagedExternally = Boolean(externalAccountManagementUrl);
    if (SettingsStore.getValue(UIFeature.Deactivate) && !isAccountManagedExternally) {
        accountManagementSection = <ManagementSection onDeactivateClicked={onDeactivateClicked} />;
    }

    return (
        <SettingsTab data-testid="mx_AccountUserSettingsTab">
            <UserProfileSettings
                externalAccountManagementUrl={externalAccountManagementUrl}
                canSetDisplayName={canSetDisplayName}
                canSetAvatar={canSetAvatar}
            />
            {(!isAccountManagedExternally || canMake3pidChanges) && (
                <UserPersonalInfoSettings canMake3pidChanges={canMake3pidChanges} />
            )}
            <AccountSection
                canChangePassword={canChangePassword}
                passwordManagedExternally={passwordManagedExternally}
                passwordPolicyResolved={passwordPolicyResolved}
                onPasswordChanged={onPasswordChanged}
                onPasswordChangeError={onPasswordChangeError}
            />
            {accountManagementSection}
        </SettingsTab>
    );
};

export default AccountUserSettingsTab;
