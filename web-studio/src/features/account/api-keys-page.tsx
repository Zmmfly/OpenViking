import { accountRequest } from '#/features/account/api'
import type { PersonalApiKey } from '#/features/account/api'
import { ErrorMessage } from '#/shared/components/error-message'
import { copyTextToClipboard } from '#/shared/lib/clipboard'
import { showErrorToast } from '#/shared/lib/error-toast'
import { Button } from '#/shared/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/shared/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/shared/ui/dialog'
import { Input } from '#/shared/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/shared/ui/table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusIcon, RotateCwIcon, Trash2Icon } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const url = '/api/v1/me/api-keys'

export function ApiKeysPage() {
  const { t, i18n } = useTranslation('account')
  const queryClient = useQueryClient()
  const keys = useQuery({
    queryKey: ['personal-api-keys'],
    queryFn: () => accountRequest<PersonalApiKey[]>(url),
  })
  const [adding, setAdding] = React.useState(false)
  const [label, setLabel] = React.useState('')
  const [secret, setSecret] = React.useState('')
  const [action, setAction] = React.useState<{
    key: PersonalApiKey
    rotate: boolean
  } | null>(null)
  const mutation = useMutation({
    mutationFn: (
      input: { label: string } | { key: PersonalApiKey; rotate: boolean },
    ) =>
      'label' in input
        ? accountRequest<PersonalApiKey & { api_key: string }>(
            url,
            'POST',
            input,
          )
        : accountRequest<PersonalApiKey & { api_key?: string }>(
            `${url}/${encodeURIComponent(input.key.key_id)}${input.rotate ? '/rotate' : ''}`,
            input.rotate ? 'POST' : 'DELETE',
          ),
    onError: (error) => showErrorToast(error),
    onSuccess: async (result) => {
      setAdding(false)
      setLabel('')
      setAction(null)
      if (result.api_key) setSecret(result.api_key)
      else toast.success(t('keyDeleted'))
      await queryClient.invalidateQueries({ queryKey: ['personal-api-keys'] })
    },
  })
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t('keysTitle')}</CardTitle>
          <Button onClick={() => setAdding(true)}>
            <PlusIcon />
            {t('addKey')}
          </Button>
        </div>
        <CardDescription>{t('keysDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {keys.isPending ? (
          <p role="status">{t('loading')}</p>
        ) : keys.isError ? (
          <ErrorMessage error={keys.error} />
        ) : !keys.data.length ? (
          <p className="text-muted-foreground">{t('noKeys')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('label')}</TableHead>
                <TableHead>{t('keysTitle')}</TableHead>
                <TableHead>{t('createdAt')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.data.map((key) => (
                <TableRow key={key.key_id}>
                  <TableCell>
                    {key.label ||
                      t(key.key_id === 'primary' ? 'legacyKey' : 'unnamed')}
                  </TableCell>
                  <TableCell>
                    <code>{key.prefix}…</code>
                  </TableCell>
                  <TableCell>
                    {key.created_at
                      ? new Date(key.created_at).toLocaleString(i18n.language)
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={mutation.isPending}
                        onClick={() => setAction({ key, rotate: true })}
                      >
                        <RotateCwIcon />
                        {t('rotate')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={mutation.isPending}
                        onClick={() => setAction({ key, rotate: false })}
                      >
                        <Trash2Icon />
                        {t('delete')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Dialog
          open={adding}
          onOpenChange={(open) => {
            if (!mutation.isPending) setAdding(open)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('addKey')}</DialogTitle>
              <DialogDescription>{t('keysDescription')}</DialogDescription>
            </DialogHeader>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                mutation.mutate({ label })
              }}
            >
              <label className="grid gap-2 text-sm">
                {t('label')}
                <Input
                  value={label}
                  maxLength={128}
                  placeholder={t('labelPlaceholder')}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </label>
              <DialogFooter>
                <Button type="submit" disabled={mutation.isPending}>
                  {t('addKey')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={Boolean(secret)}
          onOpenChange={(open) => {
            if (!open) setSecret('')
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('secretTitle')}</DialogTitle>
              <DialogDescription>{t('secretDescription')}</DialogDescription>
            </DialogHeader>
            <code className="break-all rounded border bg-muted p-3 text-sm">
              {secret}
            </code>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() =>
                  void copyTextToClipboard(secret)
                    .then(() => toast.success(t('copied')))
                    .catch(showErrorToast)
                }
              >
                {t('copy')}
              </Button>
              <Button onClick={() => setSecret('')}>{t('done')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={Boolean(action)}
          onOpenChange={(open) => {
            if (!open && !mutation.isPending) setAction(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t(action?.rotate ? 'rotateTitle' : 'deleteTitle')}
              </DialogTitle>
              <DialogDescription>
                {t(action?.rotate ? 'rotateDescription' : 'deleteDescription')}
              </DialogDescription>
            </DialogHeader>
            <p>{action?.key.label || t('unnamed')}</p>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => setAction(null)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="destructive"
                disabled={mutation.isPending}
                onClick={() => action && mutation.mutate(action)}
              >
                {t(action?.rotate ? 'rotate' : 'delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
