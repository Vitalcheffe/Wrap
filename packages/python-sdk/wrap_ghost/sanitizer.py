"""
WRAP NEBULA v2.0 - Input Sanitizer
Input sanitization before sending to Core Engine (SDK level)
"""

import hashlib
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Pattern


class DetectionType(str, Enum):
    PROMPT_INJECTION = "prompt_injection"
    PII_EMAIL = "pii_email"
    PII_PHONE = "pii_phone"
    PII_SSN = "pii_ssn"
    PII_CREDIT_CARD = "pii_credit_card"
    PII_ADDRESS = "pii_address"
    PROFANITY = "profanity"
    MALICIOUS_CODE = "malicious_code"
    SENSITIVE_KEYWORD = "sensitive_keyword"


class Severity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class DetectionResult:
    """Result of a detection"""
    type: DetectionType
    pattern: str
    match: str
    position: Dict[str, int]
    severity: Severity

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type.value,
            "pattern": self.pattern,
            "match": self.match,
            "position": self.position,
            "severity": self.severity.value,
        }


@dataclass
class SanitizationResult:
    """Result of sanitization"""
    original: str
    sanitized: Optional[str]
    rejected: bool
    reason: Optional[str] = None
    detections: List[DetectionResult] = field(default_factory=list)
    modified: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "original": self.original,
            "sanitized": self.sanitized,
            "rejected": self.rejected,
            "reason": self.reason,
            "detections": [d.to_dict() for d in self.detections],
            "modified": self.modified,
        }


@dataclass
class SanitizerConfig:
    """Configuration for the sanitizer"""
    enable_prompt_injection: bool = True
    enable_pii_detection: bool = True
    enable_profanity_filter: bool = True
    enable_sensitive_keywords: bool = True
    reject_threshold: Severity = Severity.HIGH
    mask_pii: bool = True
    mask_char: str = "*"


class InputSanitizer:
    """
    Input sanitizer for detecting and handling:
    - Prompt injection attacks
    - PII (Personally Identifiable Information)
    - Profanity
    - Sensitive keywords
    - Malicious code patterns
    """

    def __init__(self, config: Optional[SanitizerConfig] = None):
        self.config = config or SanitizerConfig()
        self._patterns: Dict[DetectionType, Dict[str, Any]] = {}
        self._initialize_patterns()

    def _initialize_patterns(self) -> None:
        """Initialize detection patterns"""
        # Prompt injection patterns
        if self.config.enable_prompt_injection:
            self._patterns[DetectionType.PROMPT_INJECTION] = {
                "pattern": re.compile(
                    r"(?:ignore\s+(?:all\s+)?(?:previous|above)\s+instructions?|"
                    r"system:\s*you\s+are|disregard\s+(?:all\s+)?(?:previous|above)|"
                    r"forget\s+(?:(?:all|everything)\s+)*(?:previous|above)|override\s+(?:all\s+)?(?:previous|above)|"
                    r"new\s+instructions?:|your\s+new\s+(?:role|task|instructions?)|"
                    r"act\s+as\s+(?:if\s+you\s+are|a|an)|pretend\s+(?:to\s+be|you\s+are)|"
                    r"simulate\s+(?:being|a|an)|roleplay\s+(?:as|that)|"
                    r"you\s+must\s+(?:now|always|forget)|\<\|im_start\|\>|\<\|im_end\|\>)",
                    re.IGNORECASE,
                ),
                "severity": Severity.CRITICAL,
            }

        # PII patterns
        if self.config.enable_pii_detection:
            # Email
            self._patterns[DetectionType.PII_EMAIL] = {
                "pattern": re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"),
                "severity": Severity.MEDIUM,
            }

            # Phone
            self._patterns[DetectionType.PII_PHONE] = {
                "pattern": re.compile(
                    r"(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}"
                ),
                "severity": Severity.MEDIUM,
            }

            # SSN
            self._patterns[DetectionType.PII_SSN] = {
                "pattern": re.compile(r"\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b"),
                "severity": Severity.HIGH,
            }

            # Credit Card
            self._patterns[DetectionType.PII_CREDIT_CARD] = {
                "pattern": re.compile(
                    r"\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|"
                    r"3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b"
                ),
                "severity": Severity.CRITICAL,
            }

            # Address
            self._patterns[DetectionType.PII_ADDRESS] = {
                "pattern": re.compile(
                    r"\d+\s+[a-zA-Z\s]+(?:street|st|avenue|ave|road|rd|lane|ln|"
                    r"drive|dr|court|ct|boulevard|blvd)\.?(?:\s+[a-zA-Z\s]+)?",
                    re.IGNORECASE,
                ),
                "severity": Severity.MEDIUM,
            }

        # Profanity
        if self.config.enable_profanity_filter:
            self._patterns[DetectionType.PROFANITY] = {
                "pattern": re.compile(
                    r"\b(?:fuck|shit|damn|ass|bitch|bastard|crap|dick|piss|whore|slut)\b",
                    re.IGNORECASE,
                ),
                "severity": Severity.LOW,
            }

        # Sensitive keywords
        if self.config.enable_sensitive_keywords:
            self._patterns[DetectionType.SENSITIVE_KEYWORD] = {
                "pattern": re.compile(
                    r"\b(?:password|secret|api_key|apikey|token|auth|credential|private_key)"
                    r"\s*[=:]\s*\S+",
                    re.IGNORECASE,
                ),
                "severity": Severity.CRITICAL,
            }

        # Malicious code
        self._patterns[DetectionType.MALICIOUS_CODE] = {
            "pattern": re.compile(
                r"(?:eval\s*\(|Function\s*\(|setTimeout\s*\(\s*['\"`]|"
                r"setInterval\s*\(\s*['\"`]|document\.write|innerHTML\s*=|outerHTML\s*=)",
                re.IGNORECASE,
            ),
            "severity": Severity.HIGH,
        }

    def sanitize(self, text: str) -> SanitizationResult:
        """
        Sanitize input text.

        Args:
            text: Input text to sanitize

        Returns:
            SanitizationResult with sanitized text or rejection reason
        """
        detections: List[DetectionResult] = []
        sanitized = text
        rejected = False
        reason: Optional[str] = None

        # Run all pattern detections
        for detection_type, config in self._patterns.items():
            pattern = config["pattern"]
            severity = config["severity"]

            for match in pattern.finditer(text):
                detections.append(
                    DetectionResult(
                        type=detection_type,
                        pattern=pattern.pattern,
                        match=match.group(),
                        position={"start": match.start(), "end": match.end()},
                        severity=severity,
                    )
                )

        # Check for rejections based on threshold
        severity_order = [Severity.LOW, Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL]
        threshold_index = severity_order.index(self.config.reject_threshold)

        for detection in detections:
            detection_index = severity_order.index(detection.severity)

            if detection_index >= threshold_index:
                rejected = True
                reason = f"Detected {detection.type.value} with severity {detection.severity.value}"
                break

        # Apply masking for PII if enabled
        if self.config.mask_pii and not rejected:
            for detection in detections:
                if detection.type.value.startswith("pii_"):
                    sanitized = self._mask_text(sanitized, detection)

        return SanitizationResult(
            original=text,
            sanitized=None if rejected else sanitized,
            rejected=rejected,
            reason=reason,
            detections=detections,
            modified=sanitized != text,
        )

    def _mask_text(self, text: str, detection: DetectionResult) -> str:
        """Mask detected text"""
        before = text[: detection.position["start"]]
        after = text[detection.position["end"] :]
        masked = self.config.mask_char * len(detection.match)
        return before + masked + after

    def is_safe(self, text: str) -> bool:
        """Check if text is safe (no rejections)"""
        result = self.sanitize(text)
        return not result.rejected

    def detect_pii(self, text: str) -> List[DetectionResult]:
        """Detect only PII in text"""
        result = self.sanitize(text)
        return [d for d in result.detections if d.type.value.startswith("pii_")]

    def detect_prompt_injection(self, text: str) -> List[DetectionResult]:
        """Detect only prompt injection in text"""
        result = self.sanitize(text)
        return [d for d in result.detections if d.type == DetectionType.PROMPT_INJECTION]

    def get_all_detections(self, text: str) -> List[DetectionResult]:
        """Get all detections for text"""
        result = self.sanitize(text)
        return result.detections

    def add_custom_pattern(
        self,
        name: str,
        pattern: str,
        detection_type: DetectionType,
        severity: Severity,
    ) -> None:
        """Add a custom detection pattern"""
        # Custom patterns would be stored separately and checked in sanitize
        pass

    @staticmethod
    def hash_input(text: str) -> str:
        """Generate SHA256 hash of input"""
        return hashlib.sha256(text.encode()).hexdigest()


# ============================================================================
# Convenience Functions
# ============================================================================

def sanitize(text: str, config: Optional[SanitizerConfig] = None) -> SanitizationResult:
    """Quick sanitize function"""
    sanitizer = InputSanitizer(config)
    return sanitizer.sanitize(text)


def is_safe(text: str, config: Optional[SanitizerConfig] = None) -> bool:
    """Quick check if text is safe"""
    sanitizer = InputSanitizer(config)
    return sanitizer.is_safe(text)
