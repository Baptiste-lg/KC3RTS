import Config

config :kc3_rts, KC3RTSWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 0],
  server: false,
  check_origin: false

config :logger, level: :warning
