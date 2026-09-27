# ECS deployment

The Nginx container reads its vhost files from `/home/vmct/nginx/conf.d`, but the dictionary frontend stays on the host. Add this read-only bind mount to the `nginx` service in `/home/vmct/nginx/compose.yaml`:

```yaml
      - /home/vmct/dict.vmct.top-dist:/home/vmct/dict.vmct.top-dist:ro
```

Upload the built `dist/` contents to `/home/vmct/dict.vmct.top-dist`, install `nginx-dict.vmct.top.conf` into `/home/vmct/nginx/conf.d/`, then validate and reload Nginx:

```sh
sudo docker compose -f /home/vmct/nginx/compose.yaml up -d
sudo docker exec nginx nginx -t
sudo docker exec nginx nginx -s reload
```

The frontend calls the new same-origin dictionary API at `/api/dict/search`.