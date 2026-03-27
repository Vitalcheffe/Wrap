//! Governor binary entry point

use std::net::SocketAddr;
use governor::{GovernorConfig, SafetyGovernor};
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber)?;

    info!("Starting WRAP NEBULA Safety Governor v2.0.0");

    // Load configuration
    let config = GovernorConfig {
        listen_address: std::env::var("GOVERNOR_ADDRESS")
            .unwrap_or_else(|_| "0.0.0.0:50051".to_string()),
        ..Default::default()
    };

    // Create governor
    let _governor = SafetyGovernor::new(config)?;
    
    // Parse address
    let addr: SocketAddr = std::env::var("GOVERNOR_ADDRESS")
        .unwrap_or_else(|_| "0.0.0.0:50051".to_string())
        .parse()?;

    info!("Governor listening on {}", addr);

    // Run a simple TCP server
    use tokio::net::TcpListener;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let listener = TcpListener::bind(addr).await?;
    info!("TCP server started on {}", addr);

    loop {
        let (mut socket, addr) = listener.accept().await?;
        info!("Connection from {}", addr);

        tokio::spawn(async move {
            let mut buf = [0; 1024];
            
            loop {
                let n = match socket.read(&mut buf).await {
                    Ok(n) if n == 0 => return,
                    Ok(n) => n,
                    Err(e) => {
                        eprintln!("Error reading from socket: {}", e);
                        return;
                    }
                };

                // Echo response (in production, handle protocol)
                if let Err(e) = socket.write_all(&buf[0..n]).await {
                    eprintln!("Error writing to socket: {}", e);
                    return;
                }
            }
        });
    }
}
