import Config

config :kc3_rts, KC3RTSWeb.Endpoint,
  http: [ip: {0, 0, 0, 0}, port: String.to_integer(System.get_env("PORT") || "4000")],
  secret_key_base: System.fetch_env!("SECRET_KEY_BASE"),
  server: true,
  check_origin: ["//" <> (System.get_env("PHX_HOST") || "localhost")]
