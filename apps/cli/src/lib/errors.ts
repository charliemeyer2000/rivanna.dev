export class RvError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SSHConnectionError extends RvError {
  constructor(message: string) {
    super(message, "SSH_CONNECTION_ERROR");
  }
}

export class SSHAuthError extends RvError {
  constructor(message: string) {
    super(message, "SSH_AUTH_ERROR");
  }
}

export class SSHTimeoutError extends RvError {
  constructor(message: string) {
    super(message, "SSH_TIMEOUT");
  }
}

export class VPNError extends RvError {
  constructor() {
    super(
      "Cannot reach Rivanna. Make sure you are connected to the UVA VPN (Cisco AnyConnect).",
      "VPN_ERROR",
    );
  }
}

export class ConfigError extends RvError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR");
  }
}

export class SlurmParseError extends RvError {
  constructor(parser: string, message: string) {
    super(`Failed to parse ${parser} output: ${message}`, "SLURM_PARSE_ERROR");
  }
}

export class AllocatorError extends RvError {
  constructor(message: string) {
    super(message, "ALLOCATOR_ERROR");
  }
}

export class NotInitializedError extends RvError {
  constructor() {
    super(
      'rv is not initialized. Run "rv init" to get started.',
      "NOT_INITIALIZED",
    );
  }
}
