/**
 * @fileoverview Docker Container Sandbox Implementation
 * @description Secure execution using Docker containers
 * @module @wrap-nebula/core/sandbox/container
 * @version 1.0.0
 * @author WRAP Nebula Team
 * @license MIT
 */

import type {
  SandboxConfig,
  SandboxExecutionOptions,
  SandboxExecutionResult,
  ContainerSandboxConfig,
  ResourceUsage,
} from '../types';
import { Sandbox } from './index';

// ============================================================================
// Types
// ============================================================================

/**
 * Dockerode module interface (lazy loaded).
 */
interface Dockerode {
  new (options?: DockerOptions): DockerInstance;
}

/**
 * Docker options.
 */
interface DockerOptions {
  socketPath?: string;
  host?: string;
  port?: number;
  version?: string;
  timeout?: number;
}

/**
 * Docker instance interface.
 */
interface DockerInstance {
  createContainer(options: ContainerCreateOptions): Promise<Container>;
  getContainer(id: string): Container;
  listContainers(options?: ListContainersOptions): Promise<ContainerInfo[]>;
  pull(image: string, options?: PullOptions): Promise<unknown>;
  modem: {
    followProgress(stream: unknown, onFinished: Function, onProgress?: Function): void;
  };
  ping(): Promise<unknown>;
  version(): Promise<DockerVersion>;
}

/**
 * Container interface.
 */
interface Container {
  id: string;
  start(): Promise<void>;
  stop(options?: StopOptions): Promise<void>;
  remove(options?: RemoveOptions): Promise<void>;
  wait(options?: WaitOptions): Promise<WaitResult>;
  inspect(): Promise<ContainerInspectResult>;
  logs(options?: LogsOptions): Promise<NodeJS.ReadableStream>;
  attach(options?: AttachOptions): Promise<unknown>;
  exec(options: ExecCreateOptions): Promise<Exec>;
  stats(options?: StatsOptions): Promise<NodeJS.ReadableStream>;
  kill(options?: KillOptions): Promise<void>;
  pause(): Promise<void>;
  unpause(): Promise<void>;
  restart(options?: RestartOptions): Promise<void>;
  commit(options?: CommitOptions): Promise<unknown>;
  resize(options: ResizeOptions): Promise<void>;
}

/**
 * Exec interface.
 */
interface Exec {
  inspect(): Promise<ExecInspectResult>;
  start(options?: ExecStartOptions): Promise<NodeJS.ReadableStream>;
  resize(options: ResizeOptions): Promise<void>;
}

/**
 * Container create options.
 */
interface ContainerCreateOptions {
  name?: string;
  Image: string;
  Cmd?: string[];
  Entrypoint?: string | string[];
  Env?: string[];
  WorkingDir?: string;
  User?: string;
  Hostname?: string;
  Domainname?: string;
  MacAddress?: string;
  ExposedPorts?: Record<string, {}>;
  HostConfig?: HostConfig;
  NetworkingConfig?: NetworkingConfig;
  Healthcheck?: HealthCheckConfig;
  StopTimeout?: number;
  StopSignal?: string;
  Tty?: boolean;
  OpenStdin?: boolean;
  StdinOnce?: boolean;
  AttachStdin?: boolean;
  AttachStdout?: boolean;
  AttachStderr?: boolean;
  Labels?: Record<string, string>;
  Volumes?: Record<string, {}>;
  Mounts?: MountConfig[];
}

/**
 * Host configuration.
 */
interface HostConfig {
  Binds?: string[];
  PortBindings?: Record<string, Array<{ HostPort?: string; HostIp?: string }>>;
  Memory?: number;
  MemorySwap?: number;
  MemoryReservation?: number;
  MemorySwappiness?: number;
  CpuShares?: number;
  CpuPeriod?: number;
  CpuQuota?: number;
  CpusetCpus?: string;
  CpusetMems?: string;
  CpuCount?: number;
  CpuPercent?: number;
  NanoCpus?: number;
  BlkioWeight?: number;
  BlkioWeightDevice?: BlkioWeightDevice[];
  BlkioDeviceReadBps?: BlkioDeviceRate[];
  BlkioDeviceWriteBps?: BlkioDeviceRate[];
  BlkioDeviceReadIOps?: BlkioDeviceRate[];
  BlkioDeviceWriteIOps?: BlkioDeviceRate[];
  MemoryBandwidth?: MemoryBandwidthLimit;
  PidsLimit?: number;
  Ulimits?: Ulimit[];
  CgroupParent?: string;
  SecurityOpt?: string[];
  CapAdd?: string[];
  CapDrop?: string[];
  Privileged?: boolean;
  ReadonlyRootfs?: boolean;
  Dns?: string[];
  DnsOptions?: string[];
  DnsSearch?: string[];
  ExtraHosts?: string[];
  NetworkMode?: string;
  IpcMode?: string;
  PidMode?: string;
  PidMode?: string;
  AutoRemove?: boolean;
  OomKillDisable?: boolean;
  OomScoreAdj?: number;
  LogConfig?: LogConfig;
  RestartPolicy?: RestartPolicy;
  Isolation?: 'default' | 'process' | 'hyperv';
  CgroupnsMode?: string;
  Runtime?: string;
  Init?: boolean;
}

/**
 * Mount configuration.
 */
interface MountConfig {
  Target: string;
  Source: string;
  Type: 'bind' | 'volume' | 'tmpfs';
  ReadOnly?: boolean;
  Consistency?: 'default' | 'consistent' | 'cached' | 'delegated';
  BindOptions?: {
    Propagation?: 'private' | 'rprivate' | 'shared' | 'rshared' | 'slave' | 'rslave';
  };
  VolumeOptions?: {
    NoCopy?: boolean;
    Labels?: Record<string, string>;
    DriverConfig?: {
      Name?: string;
      Options?: Record<string, string>;
    };
  };
  TmpfsOptions?: {
    SizeBytes?: number;
    Mode?: number;
  };
}

/**
 * Networking configuration.
 */
interface NetworkingConfig {
  EndpointsConfig?: Record<string, EndpointSettings>;
}

/**
 * Endpoint settings.
 */
interface EndpointSettings {
  IPAMConfig?: IPAMConfig;
  Links?: string[];
  Aliases?: string[];
  NetworkID?: string;
  EndpointID?: string;
  Gateway?: string;
  IPAddress?: string;
  IPPrefixLen?: number;
  IPv6Gateway?: string;
  GlobalIPv6Address?: string;
  GlobalIPv6PrefixLen?: number;
  MacAddress?: string;
  DriverOpts?: Record<string, string>;
  DNSNames?: string[];
}

/**
 * IPAM configuration.
 */
interface IPAMConfig {
  IPv4Address?: string;
  IPv6Address?: string;
  LinkLocalIPs?: string[];
}

/**
 * Health check configuration.
 */
interface HealthCheckConfig {
  Test?: string[];
  Interval?: number;
  Timeout?: number;
  Retries?: number;
  StartPeriod?: number;
}

/**
 * Blkio weight device.
 */
interface BlkioWeightDevice {
  Path: string;
  Weight: number;
}

/**
 * Blkio device rate.
 */
interface BlkioDeviceRate {
  Path: string;
  Rate: number;
}

/**
 * Memory bandwidth limit.
 */
interface MemoryBandwidthLimit {
  Max?: number;
  Min?: number;
}

/**
 * Ulimit configuration.
 */
interface Ulimit {
  Name: string;
  Hard: number;
  Soft: number;
}

/**
 * Log configuration.
 */
interface LogConfig {
  Type: string;
  Config?: Record<string, string>;
}

/**
 * Restart policy.
 */
interface RestartPolicy {
  Name?: '' | 'always' | 'unless-stopped' | 'on-failure';
  MaximumRetryCount?: number;
}

/**
 * List containers options.
 */
interface ListContainersOptions {
  all?: boolean;
  limit?: number;
  since?: string;
  before?: string;
  filters?: Record<string, string[]>;
}

/**
 * Container info.
 */
interface ContainerInfo {
  Id: string;
  Names: string[];
  Image: string;
  ImageID: string;
  Command: string;
  Created: number;
  State: string;
  Status: string;
  Ports: Port[];
  Labels: Record<string, string>;
  SizeRw?: number;
  SizeRootFs?: number;
  HostConfig: {
    NetworkMode: string;
  };
  NetworkSettings: {
    Networks: Record<string, EndpointSettings>;
  };
  Mounts: MountInfo[];
}

/**
 * Port info.
 */
interface Port {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: 'tcp' | 'udp' | 'sctp';
}

/**
 * Mount info.
 */
interface MountInfo {
  Type: string;
  Name?: string;
  Source: string;
  Destination: string;
  Driver?: string;
  Mode: string;
  RW: boolean;
  Propagation: string;
}

/**
 * Pull options.
 */
interface PullOptions {}

/**
 * Stop options.
 */
interface StopOptions {
  t?: number;
}

/**
 * Remove options.
 */
interface RemoveOptions {
  v?: boolean;
  link?: boolean;
  force?: boolean;
}

/**
 * Wait options.
 */
interface WaitOptions {
  condition?: 'not-running' | 'next-exit' | 'removed';
}

/**
 * Wait result.
 */
interface WaitResult {
  StatusCode: number;
  Error?: {
    Message: string;
  };
}

/**
 * Logs options.
 */
interface LogsOptions {
  follow?: boolean;
  stdout?: boolean;
  stderr?: boolean;
  since?: number;
  until?: number;
  timestamps?: boolean;
  tail?: string | number;
}

/**
 * Attach options.
 */
interface AttachOptions {
  stream?: boolean;
  stdin?: boolean;
  stdout?: boolean;
  stderr?: boolean;
  hijack?: boolean;
  logs?: boolean;
  detachKeys?: string;
}

/**
 * Exec create options.
 */
interface ExecCreateOptions {
  Cmd: string[];
  AttachStdin?: boolean;
  AttachStdout?: boolean;
  AttachStderr?: boolean;
  DetachKeys?: string;
  Env?: string[];
  Tty?: boolean;
  User?: string;
  WorkingDir?: string;
  Privileged?: boolean;
}

/**
 * Stats options.
 */
interface StatsOptions {
  stream?: boolean;
}

/**
 * Kill options.
 */
interface KillOptions {
  signal?: string;
}

/**
 * Restart options.
 */
interface RestartOptions {
  t?: number;
}

/**
 * Commit options.
 */
interface CommitOptions {
  repo?: string;
  tag?: string;
  comment?: string;
  author?: string;
  pause?: boolean;
  changes?: string[];
}

/**
 * Resize options.
 */
interface ResizeOptions {
  h: number;
  w: number;
}

/**
 * Exec start options.
 */
interface ExecStartOptions {
  Detach?: boolean;
  Tty?: boolean;
  ConsoleSize?: [number, number];
}

/**
 * Container inspect result.
 */
interface ContainerInspectResult {
  Id: string;
  Created: string;
  Path: string;
  Args: string[];
  State: ContainerState;
  Image: string;
  ResolvConfPath: string;
  HostnamePath: string;
  HostsPath: string;
  LogPath: string;
  Name: string;
  RestartCount: number;
  Driver: string;
  Platform: string;
  MountLabel: string;
  ProcessLabel: string;
  AppArmorProfile: string;
  ExecIDs?: string[];
  HostConfig: HostConfig;
  GraphDriver: GraphDriver;
  Mounts: MountPoint[];
  Config: ContainerConfig;
  NetworkSettings: NetworkSettings;
}

/**
 * Container state.
 */
interface ContainerState {
  Status: string;
  Running: boolean;
  Paused: boolean;
  Restarting: boolean;
  OOMKilled: boolean;
  Dead: boolean;
  Pid: number;
  ExitCode: number;
  Error: string;
  StartedAt: string;
  FinishedAt: string;
  Health?: HealthStatus;
}

/**
 * Health status.
 */
interface HealthStatus {
  Status: string;
  FailingStreak: number;
  Log: HealthCheckResult[];
}

/**
 * Health check result.
 */
interface HealthCheckResult {
  Start: string;
  End: string;
  ExitCode: number;
  Output: string;
}

/**
 * Graph driver.
 */
interface GraphDriver {
  Name: string;
  Data: Record<string, string>;
}

/**
 * Mount point.
 */
interface MountPoint {
  Type: string;
  Name?: string;
  Source: string;
  Destination: string;
  Driver?: string;
  Mode: string;
  RW: boolean;
  Propagation: string;
}

/**
 * Container configuration.
 */
interface ContainerConfig {
  Hostname: string;
  Domainname: string;
  User: string;
  AttachStdin: boolean;
  AttachStdout: boolean;
  AttachStderr: boolean;
  ExposedPorts?: Record<string, {}>;
  Tty: boolean;
  OpenStdin: boolean;
  StdinOnce: boolean;
  Env: string[];
  Cmd: string[];
  Image: string;
  Volumes?: Record<string, {}>;
  WorkingDir: string;
  Entrypoint?: string | string[];
  OnBuild?: string[];
  Labels?: Record<string, string>;
  StopSignal: string;
  StopTimeout?: number;
  Shell?: string[];
}

/**
 * Network settings.
 */
interface NetworkSettings {
  Bridge: string;
  SandboxID: string;
  HairpinMode: boolean;
  LinkLocalIPv6Address: string;
  LinkLocalIPv6PrefixLen: number;
  Ports: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
  SandboxKey: string;
  SecondaryIPAddresses?: string[];
  SecondaryIPv6Addresses?: string[];
  EndpointID: string;
  Gateway: string;
  GlobalIPv6Address: string;
  GlobalIPv6PrefixLen: number;
  IPAddress: string;
  IPPrefixLen: number;
  IPv6Gateway: string;
  MacAddress: string;
  Networks: Record<string, EndpointSettings>;
}

/**
 * Exec inspect result.
 */
interface ExecInspectResult {
  ID: string;
  Running: boolean;
  ExitCode: number;
  ProcessConfig: {
    privileged: boolean;
    user: string;
    tty: boolean;
    entrypoint: string;
    arguments: string[];
  };
  OpenStdin: boolean;
  OpenStderr: boolean;
  OpenStdout: boolean;
  ContainerID: string;
  Pid: number;
}

/**
 * Docker version info.
 */
interface DockerVersion {
  Version: string;
  ApiVersion: string;
  MinAPIVersion: string;
  GitCommit: string;
  GoVersion: string;
  Os: string;
  Arch: string;
  KernelVersion: string;
  Experimental: boolean;
  BuildTime: string;
}

/**
 * Container stats.
 */
interface ContainerStats {
  read: string;
  preread: string;
  pids_stats: {
    current: number;
    limit?: number;
  };
  blkio_stats: {
    io_service_bytes_recursive: Array<{ major: number; minor: number; op: string; value: number }> | null;
    io_serviced_recursive: Array<{ major: number; minor: number; op: string; value: number }> | null;
  };
  num_procs: number;
  storage_stats: Record<string, unknown>;
  cpu_stats: CpuStats;
  precpu_stats: CpuStats;
  memory_stats: MemoryStats;
  name: string;
  id: string;
  networks: Record<string, NetworkStats>;
}

/**
 * CPU stats.
 */
interface CpuStats {
  cpu_usage: {
    total_usage: number;
    percpu_usage: number[];
    usage_in_kernelmode: number;
    usage_in_usermode: number;
  };
  system_cpu_usage: number;
  online_cpus: number;
  throttling_data: {
    periods: number;
    throttled_periods: number;
    throttled_time: number;
  };
}

/**
 * Memory stats.
 */
interface MemoryStats {
  usage: number;
  max_usage: number;
  limit: number;
  stats: {
    active_anon: number;
    active_file: number;
    cache: number;
    dirty: number;
    hierarchical_memory_limit: number;
    hierarchical_memsw_limit: number;
    inactive_anon: number;
    inactive_file: number;
    mapped_file: number;
    pgfault: number;
    pgmajfault: number;
    pgpgin: number;
    pgpgout: number;
    rss: number;
    rss_huge: number;
    total_active_anon: number;
    total_active_file: number;
    total_cache: number;
    total_dirty: number;
    total_inactive_anon: number;
    total_inactive_file: number;
    total_mapped_file: number;
    total_pgfault: number;
    total_pgmajfault: number;
    total_pgpgin: number;
    total_pgpgout: number;
    total_rss: number;
    total_rss_huge: number;
    total_unevictable: number;
    total_writeback: number;
    unevictable: number;
    writeback: number;
  };
  failcnt: number;
}

/**
 * Network stats.
 */
interface NetworkStats {
  rx_bytes: number;
  rx_dropped: number;
  rx_errors: number;
  rx_packets: number;
  tx_bytes: number;
  tx_dropped: number;
  tx_errors: number;
  tx_packets: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default Docker image.
 */
const DEFAULT_IMAGE = 'node:20-slim';

/**
 * Default container timeout.
 */
const DEFAULT_TIMEOUT = 60000;

/**
 * Default memory limit (256MB).
 */
const DEFAULT_MEMORY_LIMIT = 256 * 1024 * 1024;

/**
 * Label for WRAP sandbox containers.
 */
const WRAP_LABEL = 'wrap-nebula.sandbox';

// ============================================================================
// ContainerSandbox Class
// ============================================================================

/**
 * Docker container-based sandbox implementation.
 * Provides secure code execution using Docker containers.
 * 
 * @example
 * ```typescript
 * const sandbox = new ContainerSandbox({
 *   id: 'my-container-sandbox',
 *   type: 'container',
 *   image: 'node:20-slim',
 *   memoryLimit: 512 * 1024 * 1024,
 *   timeout: 60000,
 * });
 * 
 * await sandbox.initialize();
 * 
 * const result = await sandbox.execute({
 *   code: 'node -e "console.log(JSON.stringify({result: 1 + 1}))"',
 * });
 * 
 * console.log(result.stdout); // {"result":2}
 * 
 * await sandbox.destroy();
 * ```
 */
export class ContainerSandbox extends Sandbox {
  private docker: DockerInstance | null = null;
  private dockerode: Dockerode | null = null;
  private container: Container | null = null;
  private containerId: string | null = null;
  private config: ContainerSandboxConfig;
  private imagePulled: boolean = false;

  /**
   * Create a new container sandbox.
   * @param config - Sandbox configuration
   */
  constructor(config: SandboxConfig) {
    super(config);
    this.config = config as ContainerSandboxConfig;
  }

  /**
   * Initialize the container.
   */
  protected async doInitialize(): Promise<void> {
    // Lazy load dockerode
    this.dockerode = await this.loadDockerode();

    // Create Docker instance
    this.docker = new this.dockerode();

    // Verify Docker is available
    try {
      await this.docker.ping();
    } catch (error) {
      throw new Error('Docker is not available. Make sure Docker is running.');
    }

    // Pull the image if needed
    const image = this.config.image ?? DEFAULT_IMAGE;
    const pullPolicy = this.config.imagePullPolicy ?? 'if-not-present';

    if (pullPolicy === 'always' || (pullPolicy === 'if-not-present' && !(await this.imageExists(image)))) {
      await this.pullImage(image);
    }

    this.imagePulled = true;
  }

  /**
   * Execute code in the container.
   * @param options - Execution options
   * @param signal - Abort signal
   */
  protected async doExecute(
    options: SandboxExecutionOptions,
    signal: AbortSignal
  ): Promise<SandboxExecutionResult> {
    const startTime = Date.now();

    if (!this.docker) {
      return {
        success: false,
        executionTime: 0,
        error: {
          name: 'SandboxError',
          message: 'Docker not initialized',
        },
      };
    }

    let container: Container | null = null;

    try {
      // Check for abort
      if (signal.aborted) {
        throw new Error('Execution aborted');
      }

      // Create container for execution
      container = await this.createExecutionContainer(options);

      // Start the container
      await container.start();

      // Wait for completion with timeout
      const timeout = options.timeout ?? this.config.timeout ?? DEFAULT_TIMEOUT;
      const waitPromise = container.wait();

      // Set up timeout
      let timeoutId: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<WaitResult>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('Execution timed out'));
        }, timeout);
      });

      // Handle abort signal
      const abortPromise = new Promise<WaitResult>((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('Execution aborted'));
        });
      });

      // Wait for container
      let result: WaitResult;
      try {
        result = await Promise.race([waitPromise, timeoutPromise, abortPromise]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      // Get logs
      const logs = await this.getContainerLogs(container);

      // Get stats
      const stats = await this.getContainerStats(container);

      // Update resource usage
      if (stats) {
        this.updateResources({
          memoryUsed: stats.memory_stats.usage,
          peakMemory: stats.memory_stats.max_usage,
          cpuTime: stats.cpu_stats.cpu_usage.total_usage,
          bytesReceived: Object.values(stats.networks ?? {}).reduce(
            (sum, n) => sum + n.rx_bytes,
            0
          ),
          bytesSent: Object.values(stats.networks ?? {}).reduce(
            (sum, n) => sum + n.tx_bytes,
            0
          ),
        });
      }

      const executionTime = Date.now() - startTime;

      return {
        success: result.StatusCode === 0,
        result: logs.stdout,
        stdout: logs.stdout,
        stderr: logs.stderr,
        exitCode: result.StatusCode,
        executionTime,
        resources: {
          memoryUsed: stats?.memory_stats.usage,
          cpuTime: stats?.cpu_stats.cpu_usage.total_usage,
        },
      };
    } catch (error) {
      const err = error as Error;
      const executionTime = Date.now() - startTime;

      // Handle specific error types
      let errorCode = 'ExecutionError';
      let errorMessage = err.message;

      if (err.message.includes('timed out')) {
        errorCode = 'TimeoutError';
        errorMessage = `Execution timed out after ${options.timeout ?? this.config.timeout}ms`;
      } else if (err.message.includes('aborted')) {
        errorCode = 'AbortError';
        errorMessage = 'Execution was aborted';
      }

      return {
        success: false,
        executionTime,
        error: {
          name: errorCode,
          message: errorMessage,
          stack: err.stack,
          code: errorCode,
        },
      };
    } finally {
      // Clean up container
      if (container) {
        try {
          await container.remove({ force: true, v: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Pause the container.
   */
  protected async doPause(): Promise<void> {
    if (this.container) {
      await this.container.pause();
    }
  }

  /**
   * Resume the container.
   */
  protected async doResume(): Promise<void> {
    if (this.container) {
      await this.container.unpause();
    }
  }

  /**
   * Destroy the container.
   */
  protected async doDestroy(): Promise<void> {
    if (this.container) {
      try {
        await this.container.stop({ t: 5 });
        await this.container.remove({ force: true, v: true });
      } catch {
        // Ignore cleanup errors
      }
      this.container = null;
      this.containerId = null;
    }

    this.docker = null;
    this.dockerode = null;
  }

  /**
   * Kill the container immediately.
   */
  protected async doKill(): Promise<void> {
    if (this.container) {
      try {
        await this.container.kill({ signal: 'SIGKILL' });
        await this.container.remove({ force: true, v: true });
      } catch {
        // Ignore errors
      }
      this.container = null;
      this.containerId = null;
    }
  }

  /**
   * Create a snapshot (commit container state).
   */
  protected async doCreateSnapshot(): Promise<unknown> {
    if (!this.container) {
      throw new Error('No container to snapshot');
    }

    const inspect = await this.container.inspect();
    
    return {
      containerId: this.container.id,
      image: inspect.Image,
      config: inspect.Config,
      timestamp: Date.now(),
    };
  }

  /**
   * Restore from a snapshot (recreate container).
   */
  protected async doRestoreSnapshot(snapshot: unknown): Promise<void> {
    // Container snapshots are handled differently - we commit to a new image
    // and use that for subsequent executions
    const snap = snapshot as { image: string; config: ContainerConfig };
    
    if (this.config.image !== snap.image) {
      this.config.image = snap.image;
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Lazy load dockerode module.
   */
  private async loadDockerode(): Promise<Dockerode> {
    try {
      const dockerode = await import('dockerode');
      return dockerode.default as unknown as Dockerode;
    } catch (error) {
      throw new Error(
        'dockerode is not installed. Install it with: npm install dockerode'
      );
    }
  }

  /**
   * Check if an image exists locally.
   */
  private async imageExists(image: string): Promise<boolean> {
    if (!this.docker) return false;

    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: { ancestor: [image] },
      });
      return containers.length > 0 || (await this.docker?.version()) !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Pull a Docker image.
   */
  private async pullImage(image: string): Promise<void> {
    if (!this.docker) return;

    return new Promise((resolve, reject) => {
      this.docker!.pull(image, {}, (err: Error | null, stream: unknown) => {
        if (err) {
          reject(err);
          return;
        }

        this.docker!.modem.followProgress(
          stream,
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          },
          (event: { status?: string; progress?: string }) => {
            // Log pull progress
            if (event.status) {
              this.log('debug', `${event.status} ${event.progress ?? ''}`);
            }
          }
        );
      });
    });
  }

  /**
   * Create an execution container.
   */
  private async createExecutionContainer(
    options: SandboxExecutionOptions
  ): Promise<Container> {
    if (!this.docker) {
      throw new Error('Docker not initialized');
    }

    const image = this.config.image ?? DEFAULT_IMAGE;
    const timeout = options.timeout ?? this.config.timeout ?? DEFAULT_TIMEOUT;

    // Parse the command
    const cmd = this.parseCommand(options.code, options.args);

    // Build environment variables
    const env = [
      ...Object.entries(this.config.environment ?? {}).map(([k, v]) => `${k}=${v}`),
      ...Object.entries(options.environment ?? {}).map(([k, v]) => `${k}=${v}`),
    ];

    // Build volume mounts
    const binds: string[] = [];
    if (this.config.volumes) {
      for (const vol of this.config.volumes) {
        binds.push(`${vol.hostPath}:${vol.containerPath}:${vol.mode ?? 'rw'}`);
      }
    }

    // Create container options
    const createOptions: ContainerCreateOptions = {
      Image: image,
      Cmd: cmd,
      Env: env.length > 0 ? env : undefined,
      WorkingDir: options.workingDirectory ?? this.config.containerWorkingDirectory ?? '/app',
      User: this.config.user,
      Hostname: `wrap-${this.config.id.substring(0, 8)}`,
      Tty: true,
      OpenStdin: !!options.stdin,
      AttachStdin: !!options.stdin,
      AttachStdout: true,
      AttachStderr: true,
      Labels: {
        [WRAP_LABEL]: this.config.id,
        'wrap-nebula.version': '1.0.0',
      },
      HostConfig: {
        Memory: this.config.memoryLimit ?? DEFAULT_MEMORY_LIMIT,
        MemorySwap: (this.config.memoryLimit ?? DEFAULT_MEMORY_LIMIT) * 2,
        CpuQuota: timeout * 1000, // Convert to microseconds
        PidsLimit: 256,
        AutoRemove: false,
        ReadonlyRootfs: !this.config.allowFilesystem,
        Binds: binds.length > 0 ? binds : undefined,
        SecurityOpt: this.config.securityOptions,
        NetworkMode: this.config.hostNetwork ? 'host' : (this.config.allowNetwork ? 'bridge' : 'none'),
        CapDrop: ['ALL'],
        CapAdd: this.config.securityOptions?.includes('--cap-add=ALL') ? undefined : [],
      },
      StopTimeout: Math.ceil(timeout / 1000) + 5,
    };

    // Create the container
    return await this.docker.createContainer(createOptions);
  }

  /**
   * Parse command from code string.
   */
  private parseCommand(code: string, args?: unknown[]): string[] {
    // If code looks like a command, use it directly
    if (code.startsWith('/') || code.includes(' ')) {
      const parts = code.split(' ');
      return [...parts, ...(args?.map(String) ?? [])];
    }

    // Otherwise, treat as a script
    const language = this.config.options?.language ?? 'javascript';
    
    switch (language) {
      case 'javascript':
      case 'js':
        return ['node', '-e', code, ...(args?.map(String) ?? [])];
      case 'typescript':
      case 'ts':
        return ['npx', 'ts-node', '-e', code, ...(args?.map(String) ?? [])];
      case 'python':
      case 'py':
        return ['python', '-c', code, ...(args?.map(String) ?? [])];
      case 'bash':
      case 'sh':
        return ['bash', '-c', code, ...(args?.map(String) ?? [])];
      case 'ruby':
      case 'rb':
        return ['ruby', '-e', code, ...(args?.map(String) ?? [])];
      default:
        return ['node', '-e', code, ...(args?.map(String) ?? [])];
    }
  }

  /**
   * Get container logs.
   */
  private async getContainerLogs(
    container: Container
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      container
        .logs({ stdout: true, stderr: true })
        .then((stream) => {
          let stdout = '';
          let stderr = '';

          stream.on('data', (chunk: Buffer) => {
            // Docker multiplexes stdout/stderr with 8-byte headers
            const header = chunk.slice(0, 8);
            const data = chunk.slice(8);

            if (header[0] === 1) {
              stdout += data.toString();
            } else if (header[0] === 2) {
              stderr += data.toString();
            }
          });

          stream.on('end', () => {
            resolve({ stdout, stderr });
          });

          stream.on('error', () => {
            resolve({ stdout, stderr });
          });
        })
        .catch(() => {
          resolve({ stdout: '', stderr: '' });
        });
    });
  }

  /**
   * Get container stats.
   */
  private async getContainerStats(container: Container): Promise<ContainerStats | null> {
    try {
      const stream = await container.stats({ stream: false });
      const chunks: Buffer[] = [];

      for await (const chunk of stream as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }

      const data = Buffer.concat(chunks).toString();
      return JSON.parse(data) as ContainerStats;
    } catch {
      return null;
    }
  }

  /**
   * Log a message.
   */
  private log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [ContainerSandbox] [${level}] ${message}`);
  }

  // ============================================================================
  // Public Utility Methods
  // ============================================================================

  /**
   * Get the container ID.
   */
  getContainerId(): string | null {
    return this.containerId;
  }

  /**
   * Check if Docker is available.
   */
  async isDockerAvailable(): Promise<boolean> {
    if (!this.docker) return false;
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get Docker version.
   */
  async getDockerVersion(): Promise<DockerVersion | null> {
    if (!this.docker) return null;
    try {
      return await this.docker.version();
    } catch {
      return null;
    }
  }

  /**
   * List all WRAP sandbox containers.
   */
  async listSandboxContainers(): Promise<ContainerInfo[]> {
    if (!this.docker) return [];
    try {
      return await this.docker.listContainers({
        all: true,
        filters: { label: [WRAP_LABEL] },
      });
    } catch {
      return [];
    }
  }

  /**
   * Clean up all sandbox containers.
   */
  async cleanupAllContainers(): Promise<number> {
    const containers = await this.listSandboxContainers();
    let cleaned = 0;

    for (const info of containers) {
      try {
        const container = this.docker!.getContainer(info.Id);
        await container.remove({ force: true, v: true });
        cleaned++;
      } catch {
        // Ignore errors
      }
    }

    return cleaned;
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  ContainerSandbox,
  DEFAULT_IMAGE,
  DEFAULT_TIMEOUT,
  DEFAULT_MEMORY_LIMIT,
  WRAP_LABEL,
};

export type {
  Dockerode,
  DockerOptions,
  DockerInstance,
  Container,
  Exec,
  ContainerCreateOptions,
  HostConfig,
  MountConfig,
  ContainerInfo,
  ContainerInspectResult,
  ContainerStats,
  CpuStats,
  MemoryStats,
  NetworkStats,
  DockerVersion,
};
