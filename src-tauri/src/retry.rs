//! Bounded retries for the background cache work. These requests run without
//! anyone watching, so one flaky connection used to drop a class note or a
//! mailbox folder from the offline cache until the next full refresh.
//! Everything here retries temporary failures and gives up on real errors.

use std::future::Future;
use std::time::Duration;

/// Attempts for background requests. Small enough to stay quick, large enough
/// to ride out a dropped connection or a single failed request.
pub(crate) const BACKGROUND_ATTEMPTS: u32 = 3;

pub(crate) async fn with_retries<T, E, F, Fut>(
    attempts: u32,
    retryable: impl Fn(&E) -> bool,
    mut operation: F,
) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
{
    let attempts = attempts.max(1);
    let mut attempt = 1;
    loop {
        match operation().await {
            Ok(value) => return Ok(value),
            Err(error) if attempt < attempts && retryable(&error) => {
                // Back off a little more each time instead of hammering Daymap.
                tokio::time::sleep(Duration::from_millis(400 * u64::from(attempt))).await;
                attempt += 1;
            }
            Err(error) => return Err(error),
        }
    }
}
