defmodule KC3RTSWeb.Endpoint do
  @moduledoc false
  use Phoenix.Endpoint, otp_app: :kc3_rts

  socket("/socket", KC3RTSWeb.UserSocket,
    websocket: [max_frame_size: 64_000],
    longpoll: false
  )

  plug(KC3RTSWeb.Router)
end
