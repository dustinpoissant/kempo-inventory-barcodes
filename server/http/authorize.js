import { currentUserHasPermission, getSession, getSetting } from 'kempo/server/sdk.js';
import { OWNER } from '../utils/config.js';

/*
  Who is asking, as plain data the utils can use. Both functions resolve to [null, who] or [{ code, msg }, null]:

    who = { userId, manage, can(permission), canSeeQuantity() }

  `can('items:update')` tells whether they hold that permission of kempo-inventory, `manage` whether they hold
  this extension's own, and `canSeeQuantity()` whether they may see stock counts (the inventory shows them only
  to people who manage quantity).
*/
const identify = async request => {
  const token = request.cookies?.session_token;
  const [sessionError, session] = token ? await getSession({ token }) : [true, null];
  const userId = !sessionError && session?.user ? session.user.id : null;
  const granted = new Map();
  const holds = async permission => {
    if(!userId) return false;
    if(!granted.has(permission)) granted.set(permission, Boolean((await currentUserHasPermission(token, permission))[1]));
    return granted.get(permission);
  };
  const can = permission => holds(`kempo-inventory:${permission}`);
  return {
    userId,
    manage: await holds(`${OWNER}:manage`),
    can,
    canSeeQuantity: async () => (await can('quantity:adjust')) || (await can('items:update')),
    canRead: async () => {
      if(await can('items:read')) return true;
      const [, publicRead] = await getSetting('kempo-inventory', 'public_read', false);
      return publicRead === true || publicRead === 'true';
    },
  };
};

/* Reading the inventory: the inventory's own rule, which is the `items:read` permission or its `public_read` setting. */
export const authorizeRead = async request => {
  const who = await identify(request);
  if(!(await who.canRead())) return [{ code: who.userId ? 403 : 401, msg: who.userId ? 'Insufficient permissions' : 'Authentication required' }, null];
  return [null, who];
};

/* Print sheets belong to a person, so these need a signed-in one who may read the inventory. */
export const authorizeUser = async request => {
  const who = await identify(request);
  if(!who.userId) return [{ code: 401, msg: 'Authentication required' }, null];
  if(!(await who.canRead())) return [{ code: 403, msg: 'Insufficient permissions' }, null];
  return [null, who];
};

/* A permission of kempo-inventory required on top of reading. */
export const requireCan = async (who, permission) => (await who.can(permission) ? null : { code: 403, msg: 'Insufficient permissions' });

/* An item as the caller may see it: no stock count unless they manage quantity. */
export const forCaller = async (item, who) => {
  if(await who.canSeeQuantity()) return item;
  const { quantity, ...rest } = item;
  return rest;
};
