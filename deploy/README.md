# ECS deployment

The existing Nginx compose setup already mounts `/home/vmct/vmpm/dist` into the container. Keep the dictionary frontend under that existing host directory so Docker restarts preserve it:

```yaml
      - /home/vmct/dict.vmct.top-dist:/home/vmct/dict.vmct.top-dist:ro
```

Upload the built `dist/` contents to `/home/vmct/vmpm/dist/dict.vmct.top`, install `nginx-dict.vmct.top.conf` into `/home/vmct/nginx/conf.d/`, then validate and reload Nginx:

```sh
sudo docker compose -f /home/vmct/nginx/compose.yaml up -d
sudo docker exec nginx nginx -t
sudo docker exec nginx nginx -s reload
```

The frontend calls the new same-origin dictionary API at `/api/dict/search`.