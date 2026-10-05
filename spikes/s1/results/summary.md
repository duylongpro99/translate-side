| round | scenario | stream result | worker down (s after job start) | storage.session seen on restart |
|---|---|---|---|---|
| 1 | idle | - | 30.3s |  |
| 1 | noport-persist | complete 90 chunks | 120.1s |  |
| 1 | noport-platformping-long | complete 400 chunks | 430.5s |  |
| 1 | noport-platformping | complete 90 chunks | 120.1s |  |
| 1 | noport | ABORTED after 29 chunks (30.0s) | 30.0s |  |
| 1 | panelhost | complete 90 chunks | 30.3s |  |
| 1 | port-idle | ABORTED after 29 chunks (30.0s) | 30.0s | {"n":0,"scenario":"port-idle","state":"running"} |
| 1 | port-panelping-long | complete 400 chunks | alive at end |  |
| 1 | port-panelping | complete 90 chunks | alive at end |  |
| 1 | port-portmsgs-long | complete 400 chunks | 430.5s | {"n":400,"scenario":"port-portmsgs-long","state":"complete"} |
| 1 | port-portmsgs | complete 90 chunks | 120.1s | {"n":90,"scenario":"port-portmsgs","state":"complete"} |
| 2 | idle | - | 30.3s |  |
| 2 | noport-persist | complete 90 chunks | 120.1s |  |
| 2 | noport-platformping-ttfb45 | complete 60 chunks | 135.2s |  |
| 2 | noport-platformping | complete 90 chunks | 120.1s |  |
| 2 | noport | complete 90 chunks | 120.2s |  |
| 2 | panelhost | complete 90 chunks | 30.5s |  |
| 2 | port-idle | ABORTED after 29 chunks (29.9s) | 29.9s | {"n":0,"scenario":"port-idle","state":"running"} |
| 2 | port-portmsgs-ttfb45 | ABORTED after 0 chunks (30.0s) | 30.0s | {"n":0,"scenario":"port-portmsgs-ttfb45","state":"running"} |
| 2 | port-portmsgs | complete 90 chunks | 120.2s | {"n":90,"scenario":"port-portmsgs","state":"complete"} |
| 3 | idle | - | 33.4s |  |
| 3 | noport-persist | complete 90 chunks | 120.2s |  |
| 3 | noport-platformping-ttfb45 | complete 60 chunks | 135.1s |  |
| 3 | noport-platformping | complete 90 chunks | 120.1s |  |
| 3 | noport | ABORTED after 30 chunks (30.3s) | 30.3s |  |
| 3 | panelhost | complete 90 chunks | 29.9s |  |
| 3 | port-idle | ABORTED after 29 chunks (30.0s) | 30.0s | {"n":0,"scenario":"port-idle","state":"running"} |
| 3 | port-portmsgs-ttfb45 | ABORTED after 0 chunks (30.0s) | 30.0s | {"n":0,"scenario":"port-portmsgs-ttfb45","state":"running"} |
| 3 | port-portmsgs | complete 90 chunks | 120.2s | {"n":90,"scenario":"port-portmsgs","state":"complete"} |
| 4 | noport | ABORTED after 29 chunks (30.0s) | 30.0s |  |
| 4 | port-idle | ABORTED after 29 chunks (30.0s) | 30.0s | {"n":0,"scenario":"port-idle","state":"running"} |
| 5 | noport | ABORTED after 29 chunks (30.0s) | 30.0s |  |
| 5 | port-idle | ABORTED after 29 chunks (30.0s) | 30.0s | {"n":0,"scenario":"port-idle","state":"running"} |
| 6 | noport | ABORTED after 29 chunks (30.0s) | 30.0s |  |
| 6 | port-idle | complete 90 chunks | 120.1s | {"n":90,"scenario":"port-idle","state":"complete"} |
| 7 | noport | ABORTED after 29 chunks (30.0s) | 30.0s |  |
| 7 | port-idle | ABORTED after 29 chunks (30.0s) | 30.0s | {"n":0,"scenario":"port-idle","state":"running"} |
