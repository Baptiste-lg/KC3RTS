import Config

config :kc3_rts, :json_library, Jason

config :kc3_rts, KC3RTSWeb.Endpoint,
  adapter: Bandit.PhoenixAdapter,
  url: [host: "localhost"],
  http: [ip: {127, 0, 0, 1}, port: 4000],
  secret_key_base: String.duplicate("kc3-rts-development-secret-key-", 3),
  server: true,
  check_origin: false,
  pubsub_server: KC3RTS.PubSub

import_config "#{config_env()}.exs"
