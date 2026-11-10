//! Optional Touch ID unlock for the saved session on macOS.
//!
//! This is a user-interface gate, not keychain encryption. The session still
//! lives in the operating system keychain, so the keychain's own access rules
//! remain the security boundary.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unlock {
    /// Biometrics are not enrolled or not usable here. Continue with the
    /// existing keychain and password flow.
    Unavailable,
    /// The user authenticated successfully.
    Unlocked,
    /// The user cancelled, failed authentication or the prompt timed out.
    /// Do not read the saved session.
    Locked,
}

/// Ask for Touch ID when it is available. `DeviceOwnerAuthentication` is used
/// for the actual evaluation so macOS can offer the login password as a
/// fallback and so a biometric lockout does not strand the user.
#[cfg(target_os = "macos")]
pub fn unlock_if_available() -> Unlock {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use std::sync::mpsc;
    use std::time::Duration;

    // SAFETY: the context and reply block are kept alive for the duration of
    // the evaluation; dropping the context cancels a pending prompt.
    let context = unsafe { LAContext::new() };
    let biometrics = LAPolicy::DeviceOwnerAuthenticationWithBiometrics;

    // Only prompt when biometrics are actually enrolled. Without them, leave
    // the existing keychain/password flow exactly as it was.
    if unsafe { context.canEvaluatePolicy_error(biometrics) }.is_err() {
        return Unlock::Unavailable;
    }
    if unsafe { context.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication) }.is_err() {
        return Unlock::Unavailable;
    }

    let (sender, receiver) = mpsc::channel();
    let reply: RcBlock<dyn Fn(Bool, *mut NSError)> =
        RcBlock::new(move |success: Bool, _error: *mut NSError| {
            let _ = sender.send(success.as_bool());
        });
    let reason = NSString::from_str("unlock your saved Daymap session");

    // SAFETY: the method only reads the context and reason during the call and
    // retains the reply block until evaluation finishes. The reply runs on a
    // private LocalAuthentication queue; the channel below synchronises it.
    unsafe {
        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthentication,
            &reason,
            &reply,
        );
    }

    match receiver.recv_timeout(Duration::from_secs(120)) {
        Ok(true) => Unlock::Unlocked,
        Ok(false) | Err(_) => Unlock::Locked,
    }
}

#[cfg(not(target_os = "macos"))]
pub fn unlock_if_available() -> Unlock {
    Unlock::Unavailable
}
