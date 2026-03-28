//! Audit trail for the Safety Governor

use anyhow::Result;
use ed25519_dalek::{Signature, Signer, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// Audit entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    /// Entry ID
    pub id: String,
    /// Timestamp
    pub timestamp: u64,
    /// Entry type
    pub entry_type: String,
    /// Agent ID
    pub agent_id: String,
    /// Action performed
    pub action: String,
    /// Resource accessed
    pub resource: Option<String>,
    /// Additional details
    pub details: serde_json::Value,
    /// Outcome
    pub outcome: String,
    /// Previous entry hash
    pub previous_hash: String,
    /// Current hash
    pub hash: String,
    /// Ed25519 signature (hex-encoded)
    pub signature: String,
}

/// Audit trail with hash chain
pub struct AuditTrail {
    entries: Vec<AuditEntry>,
    log_path: String,
    signing_key: ed25519_dalek::SigningKey,
    verifying_key: VerifyingKey,
    last_hash: String,
}

impl AuditTrail {
    /// Create a new audit trail
    pub fn new<P: AsRef<Path>>(log_path: P) -> Result<Self> {
        let mut csprng = OsRng;
        let signing_key = ed25519_dalek::SigningKey::generate(&mut csprng);
        let verifying_key = signing_key.verifying_key().clone();

        let log_path_str = log_path.as_ref().to_string_lossy().to_string();

        let mut trail = Self {
            entries: Vec::new(),
            log_path: log_path_str,
            signing_key,
            verifying_key,
            last_hash: "0".repeat(64), // Genesis hash
        };

        // Load existing entries if log file exists
        if log_path.as_ref().exists() {
            trail.load_existing()?;
        }

        Ok(trail)
    }

    /// Log an execution
    pub fn log_execution(
        &mut self,
        command: &str,
        result: &super::sandbox::ExecutionResult,
    ) -> Result<()> {
        let entry = self.create_entry(
            "execution",
            "system",
            command,
            None,
            serde_json::json!({
                "exit_code": result.exit_code,
                "duration_ms": result.duration_ms,
                "success": result.success,
            }),
            if result.success { "success" } else { "failure" },
        );

        self.append(entry)
    }

    /// Log a permission check
    pub fn log_permission_check(
        &mut self,
        agent_id: &str,
        action: &str,
        resource: &str,
        allowed: bool,
    ) -> Result<()> {
        let entry = self.create_entry(
            "permission_check",
            agent_id,
            action,
            Some(resource),
            serde_json::json!({}),
            if allowed { "allowed" } else { "denied" },
        );

        self.append(entry)
    }

    /// Log a security event
    pub fn log_security_event(
        &mut self,
        agent_id: &str,
        event_type: &str,
        details: serde_json::Value,
    ) -> Result<()> {
        let entry = self.create_entry(
            event_type,
            agent_id,
            event_type,
            None,
            details,
            "blocked",
        );

        self.append(entry)
    }

    /// Get all entries
    pub fn entries(&self) -> &[AuditEntry] {
        &self.entries
    }

    /// Get entries for an agent
    pub fn entries_for_agent(&self, agent_id: &str) -> Vec<&AuditEntry> {
        self.entries
            .iter()
            .filter(|e| e.agent_id == agent_id)
            .collect()
    }

    /// Verify the audit trail integrity
    pub fn verify(&self) -> Result<bool> {
        let mut previous_hash = "0".repeat(64);

        for entry in &self.entries {
            // Verify hash
            let computed_hash = self.compute_hash(entry, &previous_hash);
            if computed_hash != entry.hash {
                return Ok(false);
            }

            // Verify signature
            let sig_bytes = hex::decode(&entry.signature)?;
            let signature = Signature::from_slice(&sig_bytes)?;
            if self.verifying_key.verify(entry.hash.as_bytes(), &signature).is_err() {
                return Ok(false);
            }

            previous_hash = entry.hash.clone();
        }

        Ok(true)
    }

    // Private methods

    fn create_entry(
        &self,
        entry_type: &str,
        agent_id: &str,
        action: &str,
        resource: Option<&str>,
        details: serde_json::Value,
        outcome: &str,
    ) -> AuditEntry {
        let id = Uuid::new_v4().to_string();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let hash = self.compute_hash_from_parts(
            &id,
            timestamp,
            entry_type,
            agent_id,
            action,
            resource,
            &details,
            outcome,
            &self.last_hash,
        );

        let signature = self.signing_key.sign(hash.as_bytes());

        AuditEntry {
            id,
            timestamp,
            entry_type: entry_type.to_string(),
            agent_id: agent_id.to_string(),
            action: action.to_string(),
            resource: resource.map(|s| s.to_string()),
            details,
            outcome: outcome.to_string(),
            previous_hash: self.last_hash.clone(),
            hash,
            signature: hex::encode(signature.to_bytes()),
        }
    }

    fn append(&mut self, entry: AuditEntry) -> Result<()> {
        self.last_hash = entry.hash.clone();
        self.entries.push(entry.clone());

        // Append to log file
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)?;

        writeln!(file, "{}", serde_json::to_string(&entry)?)?;

        Ok(())
    }

    fn compute_hash(&self, entry: &AuditEntry, previous_hash: &str) -> String {
        self.compute_hash_from_parts(
            &entry.id,
            entry.timestamp,
            &entry.entry_type,
            &entry.agent_id,
            &entry.action,
            entry.resource.as_deref(),
            &entry.details,
            &entry.outcome,
            previous_hash,
        )
    }

    fn compute_hash_from_parts(
        &self,
        id: &str,
        timestamp: u64,
        entry_type: &str,
        agent_id: &str,
        action: &str,
        resource: Option<&str>,
        details: &serde_json::Value,
        outcome: &str,
        previous_hash: &str,
    ) -> String {
        let mut hasher = Sha256::new();
        hasher.update(id.as_bytes());
        hasher.update(timestamp.to_string().as_bytes());
        hasher.update(entry_type.as_bytes());
        hasher.update(agent_id.as_bytes());
        hasher.update(action.as_bytes());
        if let Some(r) = resource {
            hasher.update(r.as_bytes());
        }
        hasher.update(details.to_string().as_bytes());
        hasher.update(outcome.as_bytes());
        hasher.update(previous_hash.as_bytes());

        hex::encode(hasher.finalize())
    }

    fn load_existing(&mut self) -> Result<()> {
        let file = File::open(&self.log_path)?;
        let reader = BufReader::new(file);

        for line in reader.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }

            let entry: AuditEntry = serde_json::from_str(&line)?;
            self.last_hash = entry.hash.clone();
            self.entries.push(entry);
        }

        Ok(())
    }
}
